CREATE TABLE `collection_state` (
  `owner_id` text PRIMARY KEY NOT NULL CHECK (`owner_id` = 'owner'),
  `settings_json` text NOT NULL,
  `next_run_at` text NOT NULL,
  `queued` integer DEFAULT 0 NOT NULL,
  `queued_at` text,
  `retry_at` text,
  `retry_of` text,
  `topic_cursor` integer DEFAULT 0 NOT NULL,
  `last_seen_at` text,
  `lease_token` text,
  `lease_expires_at` text,
  `active_run_id` text
);
CREATE TABLE `collection_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `trigger` text NOT NULL,
  `status` text NOT NULL,
  `started_at` text NOT NULL,
  `finished_at` text,
  `queries` integer DEFAULT 0 NOT NULL,
  `found` integer DEFAULT 0 NOT NULL,
  `added` integer DEFAULT 0 NOT NULL,
  `duplicates` integer DEFAULT 0 NOT NULL,
  `summarized` integer DEFAULT 0 NOT NULL,
  `errors_json` text DEFAULT '[]' NOT NULL,
  `plan_json` text DEFAULT '[]' NOT NULL,
  `retry_of` text
);
CREATE INDEX `collection_runs_started_at` ON `collection_runs` (`started_at`);
CREATE TABLE `collection_usage` (
  `day` text PRIMARY KEY NOT NULL,
  `web_queries` integer DEFAULT 0 NOT NULL,
  `summaries` integer DEFAULT 0 NOT NULL
);
CREATE TABLE `collection_cache` (
  `fingerprint` text PRIMARY KEY NOT NULL,
  `source` text NOT NULL,
  `query` text NOT NULL,
  `payload_json` text NOT NULL,
  `expires_at` text NOT NULL
);
CREATE TABLE `collection_backoff` (
  `source` text PRIMARY KEY NOT NULL,
  `retry_at` text NOT NULL
);
