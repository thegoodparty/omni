-- Path A (Lakehouse Federation): the read-only login the Unity Catalog
-- connection uses. Applied by hand with psql 15 or newer against the POC
-- cluster's poc_org_layer database (README step 4). The password comes from
-- the FEDERATION_PASSWORD environment variable so it never appears on a
-- command line or in this file. Safe to re-run; re-running resets the
-- password to the current value of FEDERATION_PASSWORD.

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

GRANT CONNECT ON DATABASE poc_org_layer TO databricks_federation;
GRANT USAGE ON SCHEMA public TO databricks_federation;
GRANT SELECT ON org_contact_event TO databricks_federation;
