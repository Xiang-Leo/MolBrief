/** Optional editorial additions: existing Article payloads remain valid. */
export type EntityType = "drug" | "target" | "company" | "deal";
export type FactStatus = "reported" | "not-disclosed" | "not-recorded";
export type FactDateBasis = "source-publication" | "event" | "unknown";

export type DeepDiveEvidence = {
  label: string;
  value: string;
  /** Population, denominator, endpoint, currency or other necessary qualifiers. */
  context?: string;
  sourceUrl?: string;
};

export type ArticleDeepDive = {
  background?: string;
  keyFindings?: string[];
  quantitativeEvidence?: DeepDiveEvidence[];
  implications?: string[];
  limitations?: string[];
  nextQuestions?: string[];
};

/** A curated claim from a named source, not a model's inferred knowledge. */
export type EntityFact = {
  key: string;
  label: string;
  value: string | null;
  status: FactStatus;
  sourceUrl: string;
  /** Exact day only; unknown or partial dates stay null. Never use collectedAt. */
  sourceDate: string | null;
  dateBasis: FactDateBasis;
  provenance: "curated";
  /** Short source excerpt or an editorial qualification; optional, not fabricated. */
  evidence?: string;
};

export type ArticleEntity = {
  type: EntityType;
  name: string;
  /** Only explicitly reviewed aliases merge records; no fuzzy scientific matching. */
  aliases?: string[];
  sourceUrl: string;
  provenance: "curated" | "suggested";
  facts?: EntityFact[];
};

export type ArticleKnowledge = {
  deepDive?: ArticleDeepDive;
  entities?: ArticleEntity[];
};

/** Structural input avoids coupling the pure domain layer to storage or React. */
export type KnowledgeSourceArticle = ArticleKnowledge & {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: string | null;
  collectedAt: string;
  topics: string[];
  readingBasis: string;
};

export type KnowledgeArticleReference = {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: string | null;
  readingBasis: string;
};

export type KnowledgeFact = EntityFact & {
  articleId: string;
  articleTitle: string;
  readingBasis: string;
};

export type KnowledgeField = {
  key: string;
  label: string;
  status: FactStatus | "multiple-values";
  /** Null for missing/disclosed-unknown/conflicting values; see every dated claim. */
  value: string | null;
  facts: KnowledgeFact[];
};

export type KnowledgeTimelineEntry = {
  articleId: string;
  title: string;
  url: string;
  source: string;
  date: string | null;
  dateBasis: "article-publication" | "unknown";
  readingBasis: string;
  facts: KnowledgeFact[];
};

export type KnowledgeEntity = {
  id: string;
  type: EntityType;
  name: string;
  aliases: string[];
  articles: KnowledgeArticleReference[];
  timeline: KnowledgeTimelineEntry[];
  facts: KnowledgeFact[];
  fields: KnowledgeField[];
  sourceUrls: string[];
};

export type KnowledgeTopicSuggestion = {
  name: string;
  articleIds: string[];
  articleCount: number;
  status: "suggested";
  reason: string;
};

export type KnowledgeDirectory = {
  drugs: KnowledgeEntity[];
  targets: KnowledgeEntity[];
  companies: KnowledgeEntity[];
  deals: KnowledgeEntity[];
  topicSuggestions: KnowledgeTopicSuggestion[];
};
