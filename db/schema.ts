import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";

export const articles = sqliteTable("articles", {
  id: text("id").primaryKey(),
  canonicalUrl: text("canonical_url").notNull().unique(),
  payload: text("payload").notNull(),
  collectedAt: text("collected_at").notNull(),
});
export const readingState = sqliteTable("reading_state", {
  userId: text("user_id").notNull(),
  articleId: text("article_id").notNull(),
  saved: integer("saved").notNull().default(0),
  read: integer("read").notNull().default(0),
}, (t) => [primaryKey({ columns: [t.userId, t.articleId] })]);
export const topics = sqliteTable("topics", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  query: text("query").notNull(),
  kind: text("kind").notNull(),
  reason: text("reason").notNull().default(""),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at"),
});
export const preferences = sqliteTable("preferences", {
  userId: text("user_id").primaryKey(),
  payload: text("payload").notNull(),
});
export const runs = sqliteTable("runs", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  state: text("state").notNull(),
  startedAt: text("started_at").notNull(),
  detail: text("detail").notNull().default(""),
});
export const audioAssets = sqliteTable("audio_assets", {
  id: text("id").primaryKey(),
  objectKey: text("object_key").notNull(),
  createdAt: text("created_at").notNull(),
});
export const serviceSettings = sqliteTable("service_settings", {
  userId: text("user_id").primaryKey(),
  encryptedPayload: text("encrypted_payload").notNull(),
  updatedAt: text("updated_at").notNull(),
});
export const collectionState = sqliteTable("collection_state", {
  ownerId: text("owner_id").primaryKey(), settingsJson: text("settings_json").notNull(),
  nextRunAt: text("next_run_at").notNull(), queued: integer("queued").notNull().default(0),
  queuedAt: text("queued_at"), retryAt: text("retry_at"), retryOf: text("retry_of"),
  topicCursor: integer("topic_cursor").notNull().default(0), lastSeenAt: text("last_seen_at"),
  leaseToken: text("lease_token"), leaseExpiresAt: text("lease_expires_at"), activeRunId: text("active_run_id"),
  queuedMode: text("queued_mode").notNull().default("collect"),
  queuedLimit: integer("queued_limit").notNull().default(0),
});
export const collectionRuns = sqliteTable("collection_runs", {
  id: text("id").primaryKey(), trigger: text("trigger").notNull(), status: text("status").notNull(),
  startedAt: text("started_at").notNull(), finishedAt: text("finished_at"),
  queries: integer("queries").notNull().default(0), found: integer("found").notNull().default(0),
  added: integer("added").notNull().default(0), duplicates: integer("duplicates").notNull().default(0),
  summarized: integer("summarized").notNull().default(0), errorsJson: text("errors_json").notNull().default("[]"),
  planJson: text("plan_json").notNull().default("[]"), retryOf: text("retry_of"),
  mode: text("mode").notNull().default("collect"), stage: text("stage").notNull().default("pending"),
  currentLabel: text("current_label").notNull().default(""), processed: integer("processed").notNull().default(0),
  summaryAttempts: integer("summary_attempts").notNull().default(0),
  itemLimit: integer("item_limit").notNull().default(0),
});
export const collectionUsage = sqliteTable("collection_usage", {
  day: text("day").primaryKey(), webQueries: integer("web_queries").notNull().default(0),
  summaries: integer("summaries").notNull().default(0),
});
export const collectionCache = sqliteTable("collection_cache", {
  fingerprint: text("fingerprint").primaryKey(), source: text("source").notNull(), query: text("query").notNull(),
  payloadJson: text("payload_json").notNull(), expiresAt: text("expires_at").notNull(),
});
export const collectionBackoff = sqliteTable("collection_backoff", {
  source: text("source").primaryKey(), retryAt: text("retry_at").notNull(),
});
