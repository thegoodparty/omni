-- Path B (Lakeflow Connect) source setup on the POC cluster, per
-- https://docs.databricks.com/aws/en/ingestion/lakeflow-connect/postgresql-source-setup
-- and .../postgresql-privileges (AWS RDS and Aurora). Run as poc_admin against
-- gp_api_poc after base steps 3 and 4 (README B.4). Re-running is safe: it
-- resets the replication user's password to LAKEFLOW_REPLICATION_PASSWORD and
-- sets REPLICA IDENTITY FULL on tables added by later migrations. Needs psql 15+.

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
GRANT CONNECT ON DATABASE gp_api_poc TO lakeflow_replication;
GRANT USAGE ON SCHEMA public TO lakeflow_replication;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO lakeflow_replication;
-- Tables created later by prisma migrate deploy (run as poc_admin) are readable
-- without re-running this file.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO lakeflow_replication;

-- Readable by PUBLIC already; Databricks lists them as required, and on Aurora
-- these GRANTs end with a "no privileges were granted" warning, not an error.
GRANT SELECT ON pg_catalog.pg_publication TO lakeflow_replication;
GRANT SELECT ON pg_catalog.pg_replication_slots TO lakeflow_replication;
GRANT SELECT ON pg_catalog.pg_namespace TO lakeflow_replication;
GRANT SELECT ON pg_catalog.pg_class TO lakeflow_replication;
GRANT SELECT ON pg_catalog.pg_attribute TO lakeflow_replication;
GRANT SELECT ON pg_catalog.pg_type TO lakeflow_replication;
GRANT SELECT ON pg_catalog.pg_index TO lakeflow_replication;

-- Databricks asks for FULL on tables with TOASTable columns (text, jsonb) and on
-- tables without a primary key (experiment_run). That is nearly every gp-api
-- table, so all of them get it. New tables start as DEFAULT; re-run this file
-- after each migrate deploy that adds tables.
SELECT format('ALTER TABLE public.%I REPLICA IDENTITY FULL', c.relname)
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p')
  AND c.relreplident <> 'f'
ORDER BY c.relname \gexec

-- FOR ALL TABLES picks up tables added by later migrations without
-- ALTER PUBLICATION. It needs rds_superuser on Aurora (README B.4 has the
-- fallback if it is refused).
SELECT 'CREATE PUBLICATION lakeflow_gp_api_poc FOR ALL TABLES'
WHERE NOT EXISTS (
  SELECT 1 FROM pg_publication WHERE pubname = 'lakeflow_gp_api_poc'
) \gexec

-- The slot must come after the publication. Databricks has the replication
-- user create it, which needs poc_admin to be able to SET ROLE to it.
GRANT lakeflow_replication TO CURRENT_USER;
SET ROLE lakeflow_replication;
SELECT pg_create_logical_replication_slot('lakeflow_gp_api_poc', 'pgoutput')
WHERE NOT EXISTS (
  SELECT 1 FROM pg_replication_slots WHERE slot_name = 'lakeflow_gp_api_poc'
);
RESET ROLE;

SELECT rolname,
  pg_has_role('lakeflow_replication', 'rds_replication', 'MEMBER') AS rds_replication,
  (
    SELECT count(*) FROM pg_tables
    WHERE schemaname = 'public'
      AND NOT has_table_privilege('lakeflow_replication', format('%I.%I', schemaname, tablename), 'SELECT')
  ) AS tables_without_select
FROM pg_roles WHERE rolname = 'lakeflow_replication';
SELECT p.pubname, p.puballtables,
  (SELECT count(*) FROM pg_publication_tables t WHERE t.pubname = p.pubname) AS tables
FROM pg_publication p WHERE p.pubname = 'lakeflow_gp_api_poc';
SELECT count(*) FILTER (WHERE c.relreplident = 'f') AS replica_identity_full,
  count(*) FILTER (WHERE c.relreplident <> 'f') AS replica_identity_other
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p');
SELECT slot_name, plugin, slot_type, active, wal_status
FROM pg_replication_slots WHERE slot_name = 'lakeflow_gp_api_poc';
SHOW max_slot_wal_keep_size;
