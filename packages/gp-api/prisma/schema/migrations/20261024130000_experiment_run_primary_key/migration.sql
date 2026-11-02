-- experiment_run had only a unique index on run_id, so it had no primary key
-- and therefore no replica identity. Once a logical-replication publication
-- covers it (the Databricks Lakeflow mirror), Postgres rejects every DELETE and
-- UPDATE on it (55000), which broke organization deletes through the FK cascade.
-- Promote the existing unique index to the primary key: no table rewrite, and
-- the foreign keys from meeting_briefing and others keep pointing at it.
ALTER TABLE "experiment_run"
  ADD CONSTRAINT "experiment_run_pkey" PRIMARY KEY USING INDEX "experiment_run_run_id_key";
