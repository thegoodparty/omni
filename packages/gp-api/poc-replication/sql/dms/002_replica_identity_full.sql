-- Path C: log the whole old row for every UPDATE and DELETE on the mirrored
-- tables (lambda/dms-zerobus/mirroredTables.ts). DMS needs it for full before
-- images and deletes, and it puts every TOASTed value in the WAL's old tuple
-- even when an UPDATE leaves it unchanged. The new tuple still says
-- unchanged-toast-datum, so the consumer and the views handle that too. Costs
-- extra WAL on every update. Safe to re-run; re-run after any migration that
-- drops and recreates one of these tables.

ALTER TABLE replication_probe REPLICA IDENTITY FULL;
ALTER TABLE campaign REPLICA IDENTITY FULL;
ALTER TABLE replication_canary REPLICA IDENTITY FULL;

SELECT relname, CASE relreplident WHEN 'f' THEN 'full' WHEN 'd' THEN 'default' ELSE relreplident::text END AS replica_identity
FROM pg_class
WHERE relname IN ('replication_probe', 'campaign', 'replication_canary')
ORDER BY relname;
