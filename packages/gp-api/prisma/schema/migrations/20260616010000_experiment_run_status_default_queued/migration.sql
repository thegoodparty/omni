-- Align the experiment_run.status column default with the documented lifecycle:
-- every create path sets QUEUED explicitly; a raw insert / seed that omits status
-- should default to QUEUED (visible to sweepStuckQueuedRuns), not RUNNING.
ALTER TABLE "experiment_run" ALTER COLUMN "status" SET DEFAULT 'QUEUED';
