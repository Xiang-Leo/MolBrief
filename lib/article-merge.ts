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
  return { ...existing, ...incoming, keyPoints: incoming.keyPoints.length ? incoming.keyPoints : existing.keyPoints, entities: [...entities.values()] };
}
