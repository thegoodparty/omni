-- Path C: the login DMS reads the POC database with. Applied by hand with psql
-- 15 or newer against gp_api_poc (README step C3). The password comes from the
-- DMS_SOURCE_PASSWORD environment variable so it never appears on a command
-- line; the same value goes into the Pulumi secret dmsSourcePassword. Safe to
-- re-run (it also rotates the password).
--
-- DMS needs rds_replication to create and read the logical slot and
-- rds_superuser to create its DDL capture event trigger. Its DDL audit table
-- and WAL heartbeat table go in the awsdms schema (dms.ts sets
-- DdlArtifactsSchema and HeartbeatSchema), not in public, so Prisma's schema
-- stays as its migrations left it.

\getenv dms_password DMS_SOURCE_PASSWORD
\if :{?dms_password}
\else
  \warn 'Set DMS_SOURCE_PASSWORD first'
  \quit
\endif

SELECT 'CREATE ROLE dms_repl LOGIN'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'dms_repl') \gexec

ALTER ROLE dms_repl WITH LOGIN PASSWORD :'dms_password';
GRANT rds_superuser, rds_replication TO dms_repl;

CREATE SCHEMA IF NOT EXISTS awsdms;
GRANT USAGE, CREATE ON SCHEMA awsdms TO dms_repl;
GRANT USAGE ON SCHEMA public TO dms_repl;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO dms_repl;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO dms_repl;
