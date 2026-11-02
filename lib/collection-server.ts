import { CollectionStore } from "./collection-core.mjs";
import {
  articleSchema, canonicalUrl, capabilities, db, getArticles, hash,
  pubmedSearch, summarize, webSearch,
} from "./molbrief-server";
import type { Article } from "./molbrief-types";

const store = () => new CollectionStore({ database: db() });

export function collectionStatus() {
  return { ...store().status(), capabilities: capabilities() };
}
export function saveCollectionSettings(settings: Record<string, unknown>) {
  store().save(settings);
  return collectionStatus();
}
export function enqueueCollection() {
  store().enqueue();
  return collectionStatus();
}

// Automated discovery only adds new URLs. A concurrent manual edit or import
// wins the unique URL constraint, preserving all existing evidence and state.
async function insertDiscoveredArticle(value: Article): Promise<boolean> {
  const article = articleSchema.parse(value);
  const url = canonicalUrl(article.url);
  const id = "art-" + (await hash(url)).slice(0, 16);
  const collectedAt = new Date().toISOString();
  const payload = { ...article, id, url, collectedAt };
  const result = db().prepare("INSERT OR IGNORE INTO articles(id,canonical_url,payload,collected_at) VALUES(?,?,?,?)")
    .bind(id, url, JSON.stringify(payload), collectedAt).run();
  return result.meta.changes === 1;
}

export async function tickCollection() {
  const result = await store().tick({
    capabilities: capabilities(),
    search: (query: string, source: string, options:{signal?:AbortSignal}={}) => source === "web" ? webSearch(query,options) : pubmedSearch(query,options),
    getArticles,
    insert: insertDiscoveredArticle,
    summarize,
    canonicalUrl,
  });
  return { ...collectionStatus(), result };
}
