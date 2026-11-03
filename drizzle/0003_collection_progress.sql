ALTER TABLE collection_state ADD COLUMN queued_mode text NOT NULL DEFAULT 'collect';
ALTER TABLE collection_state ADD COLUMN queued_limit integer NOT NULL DEFAULT 0;
ALTER TABLE collection_runs ADD COLUMN mode text NOT NULL DEFAULT 'collect';
ALTER TABLE collection_runs ADD COLUMN stage text NOT NULL DEFAULT 'pending';
ALTER TABLE collection_runs ADD COLUMN current_label text NOT NULL DEFAULT '';
ALTER TABLE collection_runs ADD COLUMN processed integer NOT NULL DEFAULT 0;
ALTER TABLE collection_runs ADD COLUMN summary_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE collection_runs ADD COLUMN item_limit integer NOT NULL DEFAULT 0;
