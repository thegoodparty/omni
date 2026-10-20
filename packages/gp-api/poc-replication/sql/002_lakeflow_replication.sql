-- Path B (Lakeflow Connect) source setup on the POC cluster, per
-- https://docs.databricks.com/aws/en/ingestion/lakeflow-connect/postgresql-source-setup
-- and .../postgresql-privileges (AWS RDS and Aurora). Run as poc_admin against
-- poc_org_layer after 001 (README step 5.2). Re-running is safe and resets the
-- replication user's password to LAKEFLOW_REPLICATION_PASSWORD. Needs psql 15+.

\set ON_ERROR_STOP 1
\getenv lakeflow_password LAKEFLOW_REPLICATION_PASSWORD
\if :{?lakeflow_password}
\else
  \set lakeflow_password ''
\endif
SELECT length(:'lakeflow_password') >= 16 AS lakeflow_password_ok \gset
\if :lakeflow_password_ok
\else
  DO $$ BEGIN RAISE EXCEPTION 'Set LAKEFLOW_REPLICATION_PASSWORD (16+ chars)'; END $$;
\endif

SELECT 'CREATE ROLE lakeflow_replication LOGIN'
WHERE NOT EXISTS (
  SELECT 1 FROM pg_roles WHERE rolname = 'lakeflow_replication'
) \gexec
ALTER ROLE lakeflow_replication WITH LOGIN PASSWORD :'lakeflow_password';
\unset lakeflow_password

GRANT rds_replication TO lakeflow_replication;
GRANT CONNECT ON DATABASE poc_org_layer TO lakeflow_replication;
GRANT USAGE ON SCHEMA public TO lakeflow_replication;
GRANT SELECT ON TABLE public.org_contact_event TO lakeflow_replication;

-- Readable by PUBLIC already; Databricks lists them as required, and on Aurora
-- these GRANTs end with a "no privileges were granted" warning, not an error.
GRANT SELECT ON pg_catalog.pg_publication TO lakeflow_replication;
GRANT SELECT ON pg_catalog.pg_replication_slots TO lakeflow_replication;
GRANT SELECT ON pg_catalog.pg_namespace TO lakeflow_replication;
GRANT SELECT ON pg_catalog.pg_class TO lakeflow_replication;
GRANT SELECT ON pg_catalog.pg_attribute TO lakeflow_replication;
GRANT SELECT ON pg_catalog.pg_type TO lakeflow_replication;
GRANT SELECT ON pg_catalog.pg_index TO lakeflow_replication;

-- value is text (TOASTable), so Databricks asks for FULL. The table is
-- append-only, so FULL adds nothing to the WAL for inserts.
ALTER TABLE public.org_contact_event REPLICA IDENTITY FULL;

SELECT 'CREATE PUBLICATION lakeflow_org_contact_event FOR TABLE public.org_contact_event'
WHERE NOT EXISTS (
  SELECT 1 FROM pg_publication WHERE pubname = 'lakeflow_org_contact_event'
) \gexec

-- The slot must come after the publication. Databricks has the replication
-- user create it, which needs poc_admin to be able to SET ROLE to it.
GRANT lakeflow_replication TO CURRENT_USER;
SET ROLE lakeflow_replication;
SELECT pg_create_logical_replication_slot('lakeflow_org_contact_event', 'pgoutput')
WHERE NOT EXISTS (
  SELECT 1 FROM pg_replication_slots
  WHERE slot_name = 'lakeflow_org_contact_event'
);
RESET ROLE;

SELECT rolname, rolreplication,
  pg_has_role('lakeflow_replication', 'rds_replication', 'MEMBER') AS rds_replication,
  has_table_privilege('lakeflow_replication', 'public.org_contact_event', 'SELECT') AS can_select
FROM pg_roles WHERE rolname = 'lakeflow_replication';
SELECT pubname, schemaname, tablename FROM pg_publication_tables
WHERE pubname = 'lakeflow_org_contact_event';
SELECT relname, relreplident FROM pg_class WHERE relname = 'org_contact_event';
SELECT slot_name, plugin, slot_type, active, wal_status
FROM pg_replication_slots WHERE slot_name = 'lakeflow_org_contact_event';
