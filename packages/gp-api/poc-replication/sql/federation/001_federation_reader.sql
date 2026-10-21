-- Path A (Lakehouse Federation): the read-only login the Unity Catalog
-- connection uses. Run with psql 15 or newer as poc_admin, the role that runs
-- the Prisma migrations, so the default privileges below cover every table a
-- later migration creates. The password comes from FEDERATION_PASSWORD so it
-- never appears on a command line or in this file. Safe to re-run; re-running
-- resets the password to the current value of FEDERATION_PASSWORD.

\getenv federation_password FEDERATION_PASSWORD
\if :{?federation_password}
\else
  DO $$ BEGIN RAISE EXCEPTION 'FEDERATION_PASSWORD is not set'; END $$;
\endif

SELECT NOT EXISTS (
  SELECT FROM pg_roles WHERE rolname = 'databricks_federation'
) AS create_federation_role \gset
\if :create_federation_role
  CREATE ROLE databricks_federation LOGIN;
\endif

ALTER ROLE databricks_federation WITH LOGIN PASSWORD :'federation_password';
ALTER ROLE databricks_federation CONNECTION LIMIT 40;
ALTER ROLE databricks_federation SET default_transaction_read_only = on;
ALTER ROLE databricks_federation SET statement_timeout = '30s';
ALTER ROLE databricks_federation SET idle_in_transaction_session_timeout = '60s';

GRANT CONNECT ON DATABASE gp_api_poc TO databricks_federation;
GRANT USAGE ON SCHEMA public TO databricks_federation;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO databricks_federation;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO databricks_federation;
