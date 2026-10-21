export const SOURCE_SCHEMA = 'public'

export const CANARY_TABLE = 'replication_canary'

// Tables path C mirrors, with their primary key columns. DMS selects exactly
// these, the consumer maps exactly these, and generate-views.ts writes one
// current-state view per entry. Each needs REPLICA IDENTITY FULL
// (sql/dms/002_replica_identity_full.sql).
export const MIRRORED_TABLES: Record<string, string[]> = {
  replication_probe: ['id'],
  campaign: ['id'],
  [CANARY_TABLE]: ['id'],
}
