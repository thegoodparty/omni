-- The read-only login Databricks Lakehouse Federation queries gp-api through
-- (deploy/databricks/federation/README.md). Created without a login; a DB
-- admin sets the password and LOGIN by hand.

-- Roles are cluster-wide, and the shared preview cluster runs this migration
-- once per PR database, sometimes concurrently. Each guardrail is set only
-- when it differs, because two sessions altering the same role at once fail
-- with "tuple concurrently updated".
DO $$
BEGIN
  BEGIN
    CREATE ROLE databricks_federation NOLOGIN NOREPLICATION;
  EXCEPTION WHEN duplicate_object OR unique_violation THEN
    NULL;
  END;
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'databricks_federation' AND rolconnlimit = 20
  ) THEN
    ALTER ROLE databricks_federation CONNECTION LIMIT 20;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'databricks_federation'
      AND 'statement_timeout=60s' = ANY (rolconfig)
  ) THEN
    ALTER ROLE databricks_federation SET statement_timeout = '60s';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'databricks_federation'
      AND 'default_transaction_read_only=on' = ANY (rolconfig)
  ) THEN
    ALTER ROLE databricks_federation SET default_transaction_read_only = on;
  END IF;
  EXECUTE format(
    'GRANT CONNECT ON DATABASE %I TO databricks_federation',
    current_database()
  );
END
$$;

GRANT USAGE ON SCHEMA public TO databricks_federation;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO databricks_federation;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO databricks_federation;
