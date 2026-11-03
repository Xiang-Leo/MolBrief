CREATE TABLE summary_jobs (
  id text PRIMARY KEY NOT NULL,
  article_id text NOT NULL,
  payload_json text NOT NULL,
  status text NOT NULL,
  created_at text NOT NULL,
  started_at text,
  finished_at text,
  lease_token text,
  lease_expires_at text,
  error text NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX summary_jobs_active_article ON summary_jobs(article_id) WHERE status IN ('queued','running');
