import type {
  ArticleEntity, EntityType, FactStatus, KnowledgeArticleReference,
  KnowledgeDirectory, KnowledgeEntity, KnowledgeFact, KnowledgeField,
  KnowledgeSourceArticle, KnowledgeTopicSuggestion,
} from "./knowledge-types";

export const ENTITY_TYPE_LABELS: Record<EntityType, string> = {
  drug: "药物", target: "靶点", company: "公司", deal: "BD 交易",
};

/** These are editorial slots, never values filled from titles or model memory. */
export const ENTITY_FIELDS: Record<EntityType, readonly { key: string; label: string }[]> = {
  drug: [
    { key: "target", label: "作用靶点" }, { key: "mechanism", label: "作用机制" },
    { key: "indication", label: "适应症 / 研究人群" }, { key: "clinicalStage", label: "研发阶段" },
    { key: "company", label: "研发公司" },
  ],
  target: [
    { key: "mechanism", label: "生物学机制" }, { key: "linkedDrugs", label: "关联药物" },
  ],
  company: [
    { key: "focus", label: "研发 / 业务方向" }, { key: "relatedAssets", label: "关联资产" },
  ],
  deal: [
    { key: "partners", label: "交易 / 合作双方" }, { key: "totalValue", label: "潜在总金额" },
    { key: "upfront", label: "首付款 / 近期研发款" }, { key: "milestones", label: "里程碑款" },
    { key: "territory", label: "区域" }, { key: "rights", label: "权益范围" },
    { key: "effectiveDate", label: "生效日期" },
  ],
};

const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const nameKey = (value: string) => value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
const cleanText = (value: unknown) => typeof value === "string" ? value.trim() : "";
const isEntityType = (value: unknown): value is EntityType => typeof value === "string" && Object.hasOwn(ENTITY_FIELDS, value);
const isFactStatus = (value: unknown): value is FactStatus => value === "reported" || value === "not-disclosed" || value === "not-recorded";

export function validSourceUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}

export function exactDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(value + "T00:00:00.000Z");
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}

/** Stable across input order; explicit aliases are the only cross-name join. */
export function knowledgeEntityId(type: EntityType, name: string): string {
  return type + "-" + encodeURIComponent(nameKey(name));
}

function articleReference(article: KnowledgeSourceArticle): KnowledgeArticleReference {
  return {
    id: article.id, title: article.title, url: article.url, source: article.source,
    publishedAt: exactDate(article.publishedAt), readingBasis: article.readingBasis,
  };
}

function factOrder(a: KnowledgeFact, b: KnowledgeFact): number {
  return compare(b.sourceDate || "", a.sourceDate || "") || compare(a.key, b.key)
    || compare(a.sourceUrl, b.sourceUrl) || compare(a.value || "", b.value || "")
    || compare(a.articleId, b.articleId);
}

function factsFor(entity: ArticleEntity, article: KnowledgeSourceArticle): KnowledgeFact[] {
  if (!Array.isArray(entity.facts)) return [];
  return entity.facts.flatMap((fact) => {
    if (!fact || fact.provenance !== "curated" || !isFactStatus(fact.status)) return [];
    const key = cleanText(fact.key), label = cleanText(fact.label), sourceUrl = validSourceUrl(fact.sourceUrl);
    const value = fact.status === "reported" ? cleanText(fact.value) : null;
    if (!key || !label || !sourceUrl || (fact.status === "reported" && !value)) return [];
    const dateBasis = fact.dateBasis === "source-publication" || fact.dateBasis === "event" ? fact.dateBasis : "unknown";
    const sourceDate = dateBasis === "unknown" ? null : exactDate(fact.sourceDate);
    const evidence = cleanText(fact.evidence);
    return [{
      key, label, value, status: fact.status, sourceUrl, sourceDate,
      dateBasis: sourceDate ? dateBasis : "unknown", provenance: "curated" as const,
      ...(evidence ? { evidence } : {}),
      articleId: article.id, articleTitle: article.title, readingBasis: article.readingBasis,
    }];
  });
}

function fieldsFor(type: EntityType, facts: KnowledgeFact[]): KnowledgeField[] {
  const labels = new Map(ENTITY_FIELDS[type].map((field) => [field.key, field.label]));
  for (const fact of facts) if (!labels.has(fact.key)) labels.set(fact.key, fact.label);
  return [...labels].map(([key, label]) => {
    const values = facts.filter((fact) => fact.key === key && fact.status !== "not-recorded");
    const distinct = new Set(values.map((fact) => JSON.stringify([fact.status, fact.value])));
    if (!values.length) return { key, label, status: "not-recorded", value: null, facts: facts.filter((fact) => fact.key === key) };
    if (distinct.size > 1) return { key, label, status: "multiple-values", value: null, facts: values };
    return { key, label, status: values[0].status, value: values[0].value, facts: values };
  });
}

/** Suggestions are article labels only: never promoted to entities or clinical facts. */
export function suggestKnowledgeTopics(articles: readonly KnowledgeSourceArticle[]): KnowledgeTopicSuggestion[] {
  const topics = new Map<string, { names: Set<string>; articles: Set<string> }>();
  for (const article of articles) for (const raw of Array.isArray(article.topics) ? article.topics : []) {
    const name = cleanText(raw);
    if (!name) continue;
    const key = nameKey(name), current = topics.get(key) || { names: new Set<string>(), articles: new Set<string>() };
    current.names.add(name); current.articles.add(article.id); topics.set(key, current);
  }
  return [...topics.values()].map((topic) => ({
    name: [...topic.names].sort(compare)[0], articleIds: [...topic.articles].sort(compare),
    articleCount: topic.articles.size, status: "suggested" as const,
    reason: "由已收录文章的主题标签汇总；尚未确认为实体或核对实体事实。",
  })).sort((a, b) => b.articleCount - a.articleCount || compare(nameKey(a.name), nameKey(b.name)));
}

/**
 * Pure aggregation of explicitly curated records. No network, clock, title parsing,
 * database writes or presumed drug/target/financial knowledge is involved.
 */
export function buildKnowledgeDirectory(input: readonly KnowledgeSourceArticle[]): KnowledgeDirectory {
  const directory: KnowledgeDirectory = { drugs: [], targets: [], companies: [], deals: [], topicSuggestions: [] };
  // A repeated feed row must not multiply its timeline or evidence count.
  const articles = [...new Map(input.map((article) => [article.id, article])).values()];
  directory.topicSuggestions = suggestKnowledgeTopics(articles);
  const records: { entity: ArticleEntity; article: KnowledgeSourceArticle; keys: string[] }[] = [];
  const parents = new Map<string, string>();
  const find = (key: string): string => {
    const parent = parents.get(key);
    if (!parent) { parents.set(key, key); return key; }
    if (parent === key) return key;
    const root = find(parent); parents.set(key, root); return root;
  };
  const join = (left: string, right: string) => {
    const a = find(left), b = find(right);
    if (a !== b) parents.set(compare(a, b) <= 0 ? b : a, compare(a, b) <= 0 ? a : b);
  };
  for (const article of articles) for (const entity of Array.isArray(article.entities) ? article.entities : []) {
    if (!entity || entity.provenance !== "curated" || !isEntityType(entity.type) || !cleanText(entity.name) || !validSourceUrl(entity.sourceUrl)) continue;
    const names = [entity.name, ...(Array.isArray(entity.aliases) ? entity.aliases : [])].map(cleanText).filter(Boolean);
    const keys = [...new Set(names.map((name) => entity.type + ":" + nameKey(name)))];
    keys.forEach((key) => join(keys[0], key));
    records.push({ entity, article, keys });
  }
  const groups = new Map<string, typeof records>();
  for (const record of records) {
    const root = find(record.keys[0]);
    const group = groups.get(root) || []; group.push(record); groups.set(root, group);
  }
  for (const group of groups.values()) {
    const type = group[0].entity.type;
    const names = [...new Set(group.map(({ entity }) => entity.name.trim()))].sort((a, b) => compare(nameKey(a), nameKey(b)) || compare(a, b));
    const name = names[0];
    const aliases = [...new Set(group.flatMap(({ entity }) => [entity.name, ...(entity.aliases || [])]).map(cleanText).filter(Boolean))]
      .filter((alias) => alias !== name).sort((a, b) => compare(nameKey(a), nameKey(b)) || compare(a, b));
    const articleMap = new Map(group.map(({ article }) => [article.id, articleReference(article)]));
    const facts = [...new Map(group.flatMap(({ entity, article }) => factsFor(entity, article)).map((fact) => [
      JSON.stringify([fact.articleId, fact.key, fact.status, fact.value, fact.sourceUrl, fact.sourceDate, fact.dateBasis, fact.evidence]), fact,
    ])).values()].sort(factOrder);
    const references = [...articleMap.values()].sort((a, b) => compare(b.publishedAt || "", a.publishedAt || "") || compare(a.id, b.id));
    const topic: KnowledgeEntity = {
      id: knowledgeEntityId(type, name), type, name, aliases, articles: references, facts,
      fields: fieldsFor(type, facts),
      sourceUrls: [...new Set([...group.map(({ entity }) => validSourceUrl(entity.sourceUrl)!), ...facts.map((fact) => fact.sourceUrl)])].sort(compare),
      timeline: references.map((article) => ({
        articleId: article.id, title: article.title, url: article.url, source: article.source,
        date: article.publishedAt, dateBasis: article.publishedAt ? "article-publication" : "unknown",
        readingBasis: article.readingBasis, facts: facts.filter((fact) => fact.articleId === article.id),
      })),
    };
    const key = ({ drug: "drugs", target: "targets", company: "companies", deal: "deals" } as const)[type];
    directory[key].push(topic);
  }
  for (const items of [directory.drugs, directory.targets, directory.companies, directory.deals])
    items.sort((a, b) => b.articles.length - a.articles.length || compare(nameKey(a.name), nameKey(b.name)));
  return directory;
}

export function findKnowledgeEntity(directory: KnowledgeDirectory, id: string): KnowledgeEntity | null {
  const entities = [...directory.drugs, ...directory.targets, ...directory.companies, ...directory.deals];
  // A new record may use a reviewed alias as its main name and change the
  // preferred display name. Previously shared links still identify that entity.
  return entities.find((entity) => entity.id === id)
    || entities.find((entity) => [entity.name, ...entity.aliases].some((name) => knowledgeEntityId(entity.type, name) === id))
    || null;
}

export function searchKnowledgeEntities(directory: KnowledgeDirectory, query: string, type?: EntityType): KnowledgeEntity[] {
  const needle = nameKey(query);
  return [...directory.drugs, ...directory.targets, ...directory.companies, ...directory.deals].filter((entity) =>
    (!type || entity.type === type) && (!needle || [entity.name, ...entity.aliases, ...entity.facts.filter((fact) => fact.status === "reported").map((fact) => fact.value || "")]
      .some((text) => nameKey(text).includes(needle))));
}
