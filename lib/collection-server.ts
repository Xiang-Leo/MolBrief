import {safeArticleDate} from "./publication-date.mjs";
import { CollectionStore } from "./collection-core.mjs";
import {
  articleSchema, canonicalUrl, capabilities, db, getArticles, hash,
  pubmedSearch, summarize, webSearch,
} from "./molbrief-server";
import type { Article } from "./molbrief-types";
import { applyGeneratedSummary } from "./article-merge";
import {manualSummaryActive,tickManualSummary} from './summary-server';

const store = () => new CollectionStore({ database: db() });

export function collectionStatus() {
  const pendingSummaries=db().prepare("SELECT payload FROM articles").all<{payload:string}>().results.filter(row=>{
    try{return !JSON.parse(row.payload).deepDive;}catch{return false;}
  }).length;
  const status=store().status();
  const manualActive=manualSummaryActive();
  return { ...status,running:status.running||manualActive,worker:{...status.worker,healthy:status.worker.healthy||manualActive},capabilities: capabilities(),pendingSummaries };
}
export function saveCollectionSettings(settings: Record<string, unknown>) {
  store().save(settings);
  return collectionStatus();
}
export function enqueueCollection(mode='collect',limit=0) {
  store().enqueue(mode,limit);
  return collectionStatus();
}

async function updateCollectedSummary(original:Article,generated:Article):Promise<boolean>{
  const url=canonicalUrl(original.url);
  const row=db().prepare("SELECT id,payload FROM articles WHERE canonical_url=?").bind(url).first<{id:string;payload:string}>();
  if(!row)return false;
  const stored=JSON.parse(row.payload);
  const current={...articleSchema.parse(stored),collectedAt:stored.collectedAt} as Article;
  if(current.deepDive||current.title!==original.title||current.summary!==original.summary||current.sourceText!==original.sourceText)return false;
  const article={...articleSchema.parse(applyGeneratedSummary(current,generated)),collectedAt:current.collectedAt};
  return db().prepare("UPDATE articles SET payload=? WHERE id=? AND payload=?").bind(JSON.stringify(article),row.id,row.payload).run().meta.changes===1;
}

// Automated discovery only adds new URLs. A concurrent manual edit or import
// wins the unique URL constraint, preserving all existing evidence and state.
async function insertDiscoveredArticle(value: Article): Promise<boolean> {
  const article = articleSchema.parse(safeArticleDate(value));
  const url = canonicalUrl(article.url);
  const id = "art-" + (await hash(url)).slice(0, 16);
  const collectedAt = new Date().toISOString();
  const payload = { ...article, id, url, collectedAt };
  const result = db().prepare("INSERT OR IGNORE INTO articles(id,canonical_url,payload,collected_at) VALUES(?,?,?,?)")
    .bind(id, url, JSON.stringify(payload), collectedAt).run();
  return result.meta.changes === 1;
}

export async function tickCollection() {
  const collector=store();
  db().prepare("UPDATE collection_state SET last_seen_at=? WHERE owner_id='owner'").bind(new Date().toISOString()).run();
  if(!collector.status().running){
    const manual=await tickManualSummary();
    if(manual.processed||manual.busy){
      db().prepare("UPDATE collection_state SET last_seen_at=? WHERE owner_id='owner'").bind(new Date().toISOString()).run();
      return {...collectionStatus(),manualSummary:manual};
    }
  }
  const result = await collector.tick({
    capabilities: capabilities(),
    search: (query: string, source: string, options:{signal?:AbortSignal}={}) => source === "web" ? webSearch(query,options) : pubmedSearch(query,options),
    getArticles,
    insert: insertDiscoveredArticle,
    summarize,
    updateSummary:updateCollectedSummary,
    canonicalUrl,
  });
  return { ...collectionStatus(), result };
}
