-- Source setup for the Lakeflow Connect mirror into Databricks
-- (deploy/databricks/lakeflow/README.md). Creates no replication slot: an
-- unread slot makes Aurora keep its change log, so the runbook creates it
-- right before the gateway starts.

-- Lakeflow needs every replicated table at REPLICA IDENTITY FULL. The ALTER
-- takes an ACCESS EXCLUSIVE lock held until the migration commits, so one long
-- reader would stall every table already altered. Each attempt gives up after
-- 2s and releases what it took, then tries again.
DO $$
DECLARE
  previous_lock_timeout text := current_setting('lock_timeout');
  relation regclass;
  attempt int := 1;
BEGIN
  PERFORM set_config('lock_timeout', '2s', true);
  LOOP
    BEGIN
      FOR relation IN
        SELECT c.oid
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind IN ('r', 'p')
          AND c.relpersistence = 'p'
        ORDER BY c.relname
      LOOP
        EXECUTE format('ALTER TABLE %s REPLICA IDENTITY FULL', relation);
      END LOOP;
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      IF attempt = 10 THEN
        RAISE;
      END IF;
      attempt := attempt + 1;
      PERFORM pg_sleep(3);
    END;
  END LOOP;
  PERFORM set_config('lock_timeout', previous_lock_timeout, true);
END
$$;

-- An explicit table list, not FOR ALL TABLES: that form needs a true
-- superuser, which the RDS master user (rds_superuser) is not. The event
-- trigger below adds tables created later.
DO $$
BEGIN
  EXECUTE (
    SELECT 'CREATE PUBLICATION databricks_lakeflow FOR TABLE '
      || string_agg(c.oid::regclass::text, ', ' ORDER BY c.relname)
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relpersistence = 'p'
  );
END
$$;

-- Roles are cluster-wide, and the shared preview cluster runs this migration
-- once per PR database, sometimes concurrently.
DO $$
BEGIN
  BEGIN
    CREATE ROLE databricks_lakeflow NOLOGIN;
  EXCEPTION WHEN duplicate_object OR unique_violation THEN
    NULL;
  END;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rds_replication') THEN
    GRANT rds_replication TO databricks_lakeflow;
  END IF;
  EXECUTE format(
    'GRANT CONNECT ON DATABASE %I TO databricks_lakeflow',
    current_database()
  );
END
$$;

GRANT USAGE ON SCHEMA public TO databricks_lakeflow;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO databricks_lakeflow;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO databricks_lakeflow;

CREATE FUNCTION public.databricks_lakeflow_publish_new_table()
  RETURNS event_trigger
  LANGUAGE plpgsql
AS $$
DECLARE
  relation regclass;
BEGIN
  FOR relation IN
    SELECT c.oid
    FROM pg_event_trigger_ddl_commands() created
    JOIN pg_class c ON c.oid = created.objid
    WHERE created.object_type = 'table'
      AND created.schema_name = 'public'
      AND c.relpersistence = 'p'
  LOOP
    -- Only a role that owns both the table and the publication can add it.
    -- A table created by any other role is still created, and stays out of
    -- the mirror.
    BEGIN
      EXECUTE format('ALTER TABLE %s REPLICA IDENTITY FULL', relation);
      EXECUTE format(
        'ALTER PUBLICATION databricks_lakeflow ADD TABLE %s',
        relation
      );
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE WARNING '% was not added to publication databricks_lakeflow: %',
        relation, SQLERRM;
    END;
  END LOOP;
END
$$;

CREATE EVENT TRIGGER databricks_lakeflow_publish_new_tables
  ON ddl_command_end
  WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  EXECUTE FUNCTION public.databricks_lakeflow_publish_new_table();
