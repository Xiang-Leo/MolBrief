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
