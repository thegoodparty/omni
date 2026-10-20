-- Path C target: the Delta table the DMS -> Kinesis -> Lambda -> Zerobus
-- pipeline appends to. Same columns as the Delta log
-- goodparty_data_catalog.poc_import_contacts.org_contact_event. Zerobus only
-- writes to managed Delta tables it did not create, so this must exist before
-- the Lambda runs, and it must never be dropped and recreated while the
-- pipeline is live (Zerobus cannot flush to a recreated table).
--
-- NOT NULL mirrors the Postgres table: Zerobus rejects a record that omits a
-- non-nullable column instead of writing a half-empty row.
--
-- Delivery is at least once (Kinesis and Lambda retries), so an event_id can
-- appear more than once. The person view only uses max / max_by over
-- (value, created_at), so duplicates do not change what it returns.

CREATE SCHEMA IF NOT EXISTS goodparty_data_catalog.poc_import_contacts_dms
  COMMENT 'Import contacts replication POC, path C (DMS, Kinesis, Zerobus). Drop with CASCADE after the POC.';

CREATE TABLE IF NOT EXISTS goodparty_data_catalog.poc_import_contacts_dms.org_contact_event (
  event_id STRING NOT NULL,
  org_slug STRING NOT NULL,
  person_id STRING NOT NULL,
  kind STRING NOT NULL,
  field STRING,
  value STRING,
  source STRING NOT NULL,
  import_id STRING,
  actor_user_id INT,
  created_at TIMESTAMP NOT NULL
)
CLUSTER BY (org_slug, person_id)
COMMENT 'Import contacts change log, replicated from the POC Aurora cluster by DMS, Kinesis and Zerobus.';
