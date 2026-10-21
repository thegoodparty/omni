-- Path C target: the raw change table the consumer Lambda writes through
-- Zerobus, plus the reload marker the current-state views read. Zerobus only
-- writes to managed Delta tables it did not create, so this must exist before
-- the Lambda runs, and dms_cdc_change must never be dropped and recreated
-- while the pipeline is live (Zerobus cannot flush to a recreated table).
--
-- One row per DMS change on any mirrored table. The row image stays JSON text,
-- so a Prisma migration never changes this table; only the views follow the
-- source schema (generate-views.ts). Delivery is at least once, so a change can
-- appear twice; the views keep one row per primary key, so duplicates do not
-- change what they return.

CREATE SCHEMA IF NOT EXISTS goodparty_data_catalog.gp_api_mirror_dms
  COMMENT 'gp-api replication POC, path C (DMS, Kinesis, Zerobus). Drop with CASCADE after the POC.';

CREATE TABLE IF NOT EXISTS goodparty_data_catalog.gp_api_mirror_dms.dms_cdc_change (
  source_schema STRING NOT NULL,
  source_table STRING NOT NULL,
  pk STRING NOT NULL COMMENT 'JSON array of the primary key values as strings',
  op STRING NOT NULL COMMENT 'load, insert, update or delete',
  seq STRING NOT NULL COMMENT 'Order within a primary key: 0 for full load, 1 + 40-digit $AR_H_CHANGE_SEQ for CDC',
  change_seq STRING,
  stream_position STRING,
  commit_ts TIMESTAMP,
  transaction_id STRING,
  row_image STRING NOT NULL COMMENT 'The DMS row as JSON. On an update, a column missing from it was an unchanged TOAST value',
  unchanged_toast ARRAY<STRING>,
  kinesis_sequence_number STRING NOT NULL,
  ingested_at TIMESTAMP NOT NULL
)
CLUSTER BY (source_table, pk)
COMMENT 'gp-api change stream from the POC Aurora cluster, written by DMS, Kinesis, the consumer Lambda and Zerobus.';

CREATE TABLE IF NOT EXISTS goodparty_data_catalog.gp_api_mirror_dms.dms_cdc_reload (
  source_table STRING NOT NULL,
  reloaded_at TIMESTAMP NOT NULL
)
COMMENT 'One row per DMS reload (README, C reload). Views ignore changes ingested before the latest reload of their table.';
