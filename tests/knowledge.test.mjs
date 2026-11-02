import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildKnowledgeDirectory, exactDate, findKnowledgeEntity,
  knowledgeEntityId, searchKnowledgeEntities, validSourceUrl,
} from "../lib/knowledge-core.ts";

const sourceUrl = "https://example.org/official-release";
const article = (id, additions = {}) => ({
  id, title: "A reported event", url: `https://example.org/${id}`, source: "Primary source",
  publishedAt: "2026-10-20", collectedAt: "2026-11-02T00:00:00Z",
  readingBasis: "官方公告正文", topics: [], ...additions,
});
const fact = (key, value, additions = {}) => ({
  key, label: key, value, status: "reported", sourceUrl, sourceDate: "2026-10-20",
  dateBasis: "source-publication", provenance: "curated", ...additions,
});
const entity = (type, name, additions = {}) => ({ type, name, sourceUrl, provenance: "curated", ...additions });

test("legacy articles create only labelled topic suggestions, never inferred drug or deal facts", async () => {
  const seed = JSON.parse(await readFile(new URL("../data/seed.json", import.meta.url), "utf8"));
  const legacy = seed.map(({ entities, deepDive, ...existingFields }) => existingFields);
  const result = buildKnowledgeDirectory(legacy);
  assert.deepEqual([result.drugs, result.targets, result.companies, result.deals], [[], [], [], []]);
  assert.ok(result.topicSuggestions.some((topic) => topic.name === "TL1A"));
  assert.equal(result.topicSuggestions.every((topic) => topic.status === "suggested"), true);
  const titleOnly = buildKnowledgeDirectory([article("unstructured", { title: "Drug X is Phase 3 in a $1 billion deal" })]);
  assert.deepEqual(titleOnly.drugs, []);
  assert.deepEqual(titleOnly.deals, []);
});

test("explicit aliases merge transitively within a type and input order does not change entity identity", () => {
  const input = [
    article("one", { entities: [entity("drug", "Duvakitug", { aliases: ["TEV-48574"] })] }),
    article("two", { entities: [entity("drug", "TEV-48574", { aliases: ["Reviewed alias"] })] }),
    article("three", { entities: [entity("drug", "Reviewed alias")] }),
    article("four", { entities: [entity("target", "Duvakitug")] }),
  ];
  const first = buildKnowledgeDirectory(input), reversed = buildKnowledgeDirectory([...input].reverse());
  assert.equal(first.drugs.length, 1);
  assert.equal(first.drugs[0].articles.length, 3);
  assert.equal(first.targets.length, 1);
  assert.equal(first.drugs[0].id, reversed.drugs[0].id);
  assert.ok(first.drugs[0].aliases.includes("TEV-48574"));
  assert.notEqual(first.targets[0].id, first.drugs[0].id);
});

test("similar scientific names are not merged without explicitly curated aliases", () => {
  const result = buildKnowledgeDirectory([article("a", { entities: [entity("target", "TEAD1"), entity("target", "TEAD")] })]);
  assert.equal(result.targets.length, 2);
});

test("multiple dated claims for one field stay separate and retain their original sources", () => {
  const input = [
    article("early", { entities: [entity("drug", "Compound A", { facts: [fact("clinicalStage", "Phase 1")] })] }),
    article("later", { publishedAt: "2026-11-01", entities: [entity("drug", "Compound A", { facts: [fact("clinicalStage", "Phase 2", { sourceUrl: "https://example.org/update", sourceDate: "2026-11-01", evidence: "A different dated announcement" })] })] }),
  ];
  const drug = buildKnowledgeDirectory(input).drugs[0], stage = drug.fields.find((field) => field.key === "clinicalStage");
  assert.equal(stage.status, "multiple-values");
  assert.equal(stage.value, null);
  assert.deepEqual(stage.facts.map((item) => item.value), ["Phase 2", "Phase 1"]);
  assert.equal(stage.facts[0].sourceUrl, "https://example.org/update");
  assert.deepEqual(drug.timeline.map((entry) => entry.articleId), ["later", "early"]);
  assert.equal(drug.timeline[0].facts[0].evidence, "A different dated announcement");
});

test("source-undisclosed is distinct from a field that has not been recorded", () => {
  const deal = buildKnowledgeDirectory([article("deal", { entities: [entity("deal", "A–B collaboration", {
    facts: [fact("milestones", null, { status: "not-disclosed" }), fact("partners", "A and B")],
  })] })]).deals[0];
  assert.equal(deal.fields.find((field) => field.key === "milestones").status, "not-disclosed");
  assert.equal(deal.fields.find((field) => field.key === "upfront").status, "not-recorded");
  assert.equal(deal.fields.find((field) => field.key === "effectiveDate").value, null);
  assert.equal(deal.fields.find((field) => field.key === "partners").value, "A and B");
});

test("unknown publication dates never become collection dates and invalid calendar dates stay unknown", () => {
  const drug = buildKnowledgeDirectory([article("undated", { publishedAt: null, entities: [entity("drug", "Unknown-date drug", {
    facts: [fact("clinicalStage", "Phase 1", { sourceDate: "2026-02-30" }), fact("mechanism", "Reported pathway", { sourceDate: null, dateBasis: "unknown" })],
  })] })]).drugs[0];
  assert.equal(drug.timeline[0].date, null);
  assert.equal(drug.timeline[0].dateBasis, "unknown");
  assert.equal(drug.facts.every((item) => item.sourceDate === null && item.dateBasis === "unknown"), true);
  assert.equal(exactDate("2026-02-30"), null);
  assert.equal(exactDate("2024-02-29"), "2024-02-29");
});

test("only source-backed curated entities and facts enter the factual directory", () => {
  const drug = entity("drug", "Curated compound", { facts: [
    fact("target", "Accepted target"),
    fact("clinicalStage", "Phase 3", { provenance: "model" }),
    fact("company", "Guessed company", { sourceUrl: "javascript:alert(1)" }),
    fact("mechanism", "  "),
  ] });
  const result = buildKnowledgeDirectory([article("review", { entities: [
    drug, entity("drug", "Suggested compound", { provenance: "suggested" }),
    entity("drug", "Unsourced compound", { sourceUrl: "" }),
  ] })]);
  assert.equal(result.drugs.length, 1);
  assert.deepEqual(result.drugs[0].facts.map((item) => item.key), ["target"]);
  assert.equal(validSourceUrl("https://name:password@example.org"), null);
  assert.equal(validSourceUrl("javascript:alert(1)"), null);
});

test("duplicate feed rows do not multiply records and aggregation never changes input", () => {
  const input = article("same", { topics: ["VHH", " vhh "], entities: [entity("drug", "A", { facts: [fact("target", "B")] })] });
  const before = JSON.stringify(input), result = buildKnowledgeDirectory([input, input]);
  assert.equal(JSON.stringify(input), before);
  assert.equal(result.drugs[0].facts.length, 1);
  assert.equal(result.drugs[0].timeline.length, 1);
  assert.equal(result.topicSuggestions[0].articleCount, 1);
});

test("directory lookup and search work with reviewed aliases without adding facts", () => {
  const directory = buildKnowledgeDirectory([article("lookup", { entities: [entity("drug", "Example drug", { aliases: ["ABC-123"] })] })]);
  const item = directory.drugs[0];
  assert.equal(findKnowledgeEntity(directory, item.id), item);
  assert.equal(findKnowledgeEntity(directory, "missing"), null);
  assert.deepEqual(searchKnowledgeEntities(directory, "abc-123", "drug"), [item]);
  assert.deepEqual(searchKnowledgeEntities(directory, "abc-123", "target"), []);
  assert.equal(knowledgeEntityId("drug", " ABC-123 "), knowledgeEntityId("drug", "abc-123"));
});
