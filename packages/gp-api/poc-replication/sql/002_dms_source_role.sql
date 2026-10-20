-- Path C: the login DMS reads the change log with. Applied by hand with psql
-- 15 or newer against the POC cluster's poc_org_layer database (README step
-- C3). The password comes from the DMS_SOURCE_PASSWORD environment variable so
-- it never appears on a command line; the same value goes into the Pulumi
-- secret dmsSourcePassword. Safe to re-run (it also rotates the password).
--
-- DMS needs rds_superuser and rds_replication on Aurora: rds_replication to
-- create and read the logical slot, rds_superuser to create its DDL capture
-- event trigger and heartbeat objects in public.

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
GRANT USAGE, CREATE ON SCHEMA public TO dms_repl;
GRANT SELECT ON org_contact_event TO dms_repl;
