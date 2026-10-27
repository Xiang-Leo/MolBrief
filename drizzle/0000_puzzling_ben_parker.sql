CREATE TABLE `articles` (
	`id` text PRIMARY KEY NOT NULL,
	`canonical_url` text NOT NULL,
	`payload` text NOT NULL,
	`collected_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `articles_canonical_url_unique` ON `articles` (`canonical_url`);--> statement-breakpoint
CREATE TABLE `audio_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`object_key` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reading_state` (
	`user_id` text NOT NULL,
	`article_id` text NOT NULL,
	`saved` integer DEFAULT 0 NOT NULL,
	`read` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`user_id`, `article_id`)
);
--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`state` text NOT NULL,
	`started_at` text NOT NULL,
	`detail` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `topics` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`query` text NOT NULL,
	`kind` text NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text
);
