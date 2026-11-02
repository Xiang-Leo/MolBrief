import type { Article } from "./molbrief-types";
import type { ArticleEntity } from "./knowledge-types";

/** Adding evidence to a known URL must not erase previously collected entities. */
export function mergeArticleEvidence(existing: Article | undefined, incoming: Article): Article {
  if (!existing) return incoming;
  const entities = new Map<string, ArticleEntity>();
  for (const entity of [...existing.entities || [], ...incoming.entities || []]) {
    const key = entity.type + ":" + entity.name.normalize("NFKC").trim().toLowerCase();
    const previous = entities.get(key);
    if (!previous) { entities.set(key, entity); continue; }
    const facts = [...new Map([...previous.facts || [], ...entity.facts || []].map(f => [JSON.stringify([f.key, f.status, f.value, f.sourceUrl, f.sourceDate, f.dateBasis, f.evidence]), f])).values()];
    entities.set(key, { ...previous, ...entity, provenance: previous.provenance === "curated" || entity.provenance === "curated" ? "curated" : "suggested", aliases: [...new Set([...previous.aliases || [], ...entity.aliases || []])], facts });
  }
  return { ...existing, ...incoming, publishedAt: incoming.publishedAt ?? existing.publishedAt, keyPoints: incoming.keyPoints.length ? incoming.keyPoints : existing.keyPoints, entities: [...entities.values()] };
}

/** Model-generated prose may change; the latest stored source material must not. */
export function applyGeneratedSummary(current: Article | undefined, generated: Article): Article {
  if (!current) return generated;
  return {
    ...current, title: generated.title, originalTitle: current.originalTitle ?? generated.originalTitle,
    summary: generated.summary, keyPoints: generated.keyPoints, limitations: generated.limitations,
    topics: generated.topics, deepDive: generated.deepDive ?? current.deepDive,
    entities: mergeArticleEvidence(current, generated).entities,
  };
}
