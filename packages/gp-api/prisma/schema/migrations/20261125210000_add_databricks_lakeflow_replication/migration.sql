-- Postgres side of the Databricks Lakeflow Connect CDC pipeline that copies
-- gp-api's public schema into Databricks (see deploy/AGENTS.md, "Databricks
-- CDC"). It creates the replication role, the publication the pipeline reads,
-- and an event trigger that keeps the publication complete as tables change.
-- Logical replication can be off where this runs (local, CI, previews); none
-- of it needs wal_level = logical. It makes no replication slot.

-- Roles are cluster-wide, and the shared preview cluster runs this migration
-- once per PR database, sometimes concurrently. Each guardrail is changed only
-- when it differs, because two sessions altering the same role at once fail
-- with "tuple concurrently updated". An existing role keeps its LOGIN and
-- password: dev's was made by hand, and a DB admin sets both on new ones.
DO $$
BEGIN
  BEGIN
    CREATE ROLE databricks_lakeflow NOLOGIN NOREPLICATION;
  EXCEPTION WHEN duplicate_object OR unique_violation THEN
    NULL;
  END;
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'databricks_lakeflow' AND rolconnlimit = 10
  ) THEN
    ALTER ROLE databricks_lakeflow CONNECTION LIMIT 10;
  END IF;
  -- rds_replication exists on RDS and Aurora only. It is what lets the role
  -- open a replication connection there.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rds_replication')
    AND NOT EXISTS (
      SELECT 1 FROM pg_auth_members m
      JOIN pg_roles r ON r.oid = m.roleid
      JOIN pg_roles u ON u.oid = m.member
      WHERE r.rolname = 'rds_replication' AND u.rolname = 'databricks_lakeflow'
    )
  THEN
    BEGIN
      GRANT rds_replication TO databricks_lakeflow;
    EXCEPTION WHEN duplicate_object OR unique_violation THEN
      NULL;
    END;
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

-- The only copy of the secret columns. Secrets stay out of Databricks in
-- three layers: the publication column lists keep them out of the WAL stream,
-- the column grants below keep them out of the snapshot, and the pipeline's
-- exclude_columns (gp-terraform-dataplatform) keeps the connector from asking
-- for them. A new secret column on any table fails the CI check until it is
-- added here and to exclude_columns.
CREATE OR REPLACE FUNCTION public.databricks_lakeflow_secret_columns()
RETURNS TABLE (table_name text, column_name text)
LANGUAGE sql IMMUTABLE
AS $$
  VALUES
    ('user', 'password'),
    ('user', 'password_reset_token'),
    ('peerly_phone_list', 'token'),
    ('outreach_email_sender', 'pending_forward_token_hash')
$$;

-- Every table the publication carries: the regular tables in public, each
-- with the columns to publish when it holds a secret (NULL means all of
-- them). Partitions are left out: with publish_via_partition_root the parent
-- stands for them.
CREATE OR REPLACE FUNCTION public.databricks_lakeflow_wanted_tables()
RETURNS TABLE (table_name text, columns text[])
LANGUAGE sql STABLE
AS $$
  SELECT
    c.relname::text,
    CASE WHEN EXISTS (
      SELECT 1 FROM public.databricks_lakeflow_secret_columns() s
      WHERE s.table_name = c.relname::text
    ) THEN (
      SELECT array_agg(a.attname::text ORDER BY a.attnum)
      FROM pg_attribute a
      WHERE a.attrelid = c.oid
        AND a.attnum > 0
        AND NOT a.attisdropped
        AND NOT EXISTS (
          SELECT 1 FROM public.databricks_lakeflow_secret_columns() s
          WHERE s.table_name = c.relname::text
            AND s.column_name = a.attname::text
        )
    ) END
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p')
    AND NOT c.relispartition
$$;

-- Brings the publication and the role's column grants in line with public.
-- Idempotent, and a no-op when nothing changed. It does not catch errors: a
-- silent gap in the publication is worse than a failed migration.
CREATE OR REPLACE FUNCTION public.databricks_lakeflow_sync()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  wanted_signature text;
  current_signature text;
  table_list text;
  secret_table text;
  secret_table_oid regclass;
  readable text;
BEGIN
  -- A publication for all tables cannot take column lists, so dev's hand-made
  -- one has to go. Dropping it under a live slot would silently break the
  -- pipeline, so refuse instead.
  IF EXISTS (
    SELECT 1 FROM pg_publication
    WHERE pubname = 'databricks_lakeflow' AND puballtables
  ) THEN
    IF EXISTS (
      SELECT 1 FROM pg_replication_slots WHERE database = current_database()
    ) THEN
      RAISE EXCEPTION
        'publication databricks_lakeflow publishes all tables and a replication slot exists; drop the slot before this migration can replace the publication';
    END IF;
    DROP PUBLICATION databricks_lakeflow;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'databricks_lakeflow'
  ) THEN
    BEGIN
      CREATE PUBLICATION databricks_lakeflow
        WITH (publish_via_partition_root = true);
    EXCEPTION WHEN duplicate_object OR unique_violation THEN
      NULL;
    END;
  END IF;

  SELECT string_agg(
    format('public.%s%s', w.table_name, coalesce('(' || (
      SELECT string_agg(col, ',' ORDER BY col) FROM unnest(w.columns) col
    ) || ')', '')),
    ';' ORDER BY w.table_name
  )
  INTO wanted_signature
  FROM public.databricks_lakeflow_wanted_tables() w;

  -- pg_publication_tables lists every column for a table without a column
  -- list, so only a secret table's columns are compared.
  SELECT string_agg(
    format('%s.%s%s', p.schemaname, p.tablename, CASE
      WHEN p.schemaname = 'public' AND p.tablename IN (
        SELECT s.table_name FROM public.databricks_lakeflow_secret_columns() s
      ) THEN '(' || (
        SELECT string_agg(col, ',' ORDER BY col) FROM unnest(p.attnames) col
      ) || ')'
      ELSE ''
    END),
    ';' ORDER BY p.schemaname, p.tablename
  )
  INTO current_signature
  FROM pg_publication_tables p
  WHERE p.pubname = 'databricks_lakeflow';

  IF wanted_signature IS NOT NULL
    AND wanted_signature IS DISTINCT FROM current_signature
  THEN
    SELECT string_agg(
      format('public.%I%s', w.table_name, coalesce(' (' || (
        SELECT string_agg(quote_ident(col), ', ' ORDER BY col)
        FROM unnest(w.columns) col
      ) || ')', '')),
      ', ' ORDER BY w.table_name
    )
    INTO table_list
    FROM public.databricks_lakeflow_wanted_tables() w;

    EXECUTE format(
      'ALTER PUBLICATION databricks_lakeflow SET TABLE %s',
      table_list
    );
  END IF;

  -- The snapshot reads through SELECT, so a secret table gets a column grant
  -- of everything but its secrets instead of a table grant. A column added
  -- later stays unreadable until this runs again, which the event trigger
  -- does on ALTER TABLE.
  FOR secret_table IN
    SELECT DISTINCT s.table_name
    FROM public.databricks_lakeflow_secret_columns() s
    ORDER BY 1
  LOOP
    secret_table_oid := to_regclass(format('public.%I', secret_table));
    CONTINUE WHEN secret_table_oid IS NULL;

    IF has_table_privilege('databricks_lakeflow', secret_table_oid, 'SELECT')
      OR EXISTS (
        SELECT 1 FROM pg_attribute a
        WHERE a.attrelid = secret_table_oid
          AND a.attnum > 0
          AND NOT a.attisdropped
          AND has_column_privilege(
            'databricks_lakeflow', secret_table_oid, a.attnum, 'SELECT'
          ) = EXISTS (
            SELECT 1 FROM public.databricks_lakeflow_secret_columns() s
            WHERE s.table_name = secret_table
              AND s.column_name = a.attname::text
          )
      )
    THEN
      SELECT string_agg(quote_ident(a.attname::text), ', ' ORDER BY a.attnum)
      INTO readable
      FROM pg_attribute a
      WHERE a.attrelid = secret_table_oid
        AND a.attnum > 0
        AND NOT a.attisdropped
        AND NOT EXISTS (
          SELECT 1 FROM public.databricks_lakeflow_secret_columns() s
          WHERE s.table_name = secret_table
            AND s.column_name = a.attname::text
        );
      EXECUTE format(
        'REVOKE SELECT ON TABLE public.%I FROM databricks_lakeflow',
        secret_table
      );
      EXECUTE format(
        'GRANT SELECT (%s) ON TABLE public.%I TO databricks_lakeflow',
        readable,
        secret_table
      );
    END IF;
  END LOOP;
END
$$;

-- Postgres refuses to drop a column that sits in a publication's column list,
-- and a secret table's list holds every column but its secrets. So before any
-- ALTER TABLE the tables with a column list leave the publication, and the
-- sync below puts them back, with the new column list, when the command ends.
-- Both run in the statement's own transaction, so a replication slot never
-- sees the gap.
CREATE OR REPLACE FUNCTION public.databricks_lakeflow_before_ddl()
RETURNS event_trigger
LANGUAGE plpgsql
AS $$
DECLARE
  listed record;
BEGIN
  FOR listed IN
    SELECT n.nspname, c.relname
    FROM pg_publication p
    JOIN pg_publication_rel r ON r.prpubid = p.oid
    JOIN pg_class c ON c.oid = r.prrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE p.pubname = 'databricks_lakeflow' AND r.prattrs IS NOT NULL
    ORDER BY n.nspname, c.relname
  LOOP
    EXECUTE format(
      'ALTER PUBLICATION databricks_lakeflow DROP TABLE %I.%I',
      listed.nspname,
      listed.relname
    );
  END LOOP;
END
$$;

-- Runs the sync after any DDL that creates or alters a table, in the same
-- transaction, so the publication never lags a migration. Every ALTER TABLE
-- syncs, not only those on public, because the function above has already
-- taken the secret tables out whatever table the command was for. DROP TABLE
-- needs nothing: a dropped table leaves its publication by itself. To pause
-- both during an incident: ALTER EVENT TRIGGER <name> DISABLE.
CREATE OR REPLACE FUNCTION public.databricks_lakeflow_on_ddl()
RETURNS event_trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF tg_tag = 'ALTER TABLE' OR EXISTS (
    SELECT 1 FROM pg_event_trigger_ddl_commands()
    WHERE schema_name = 'public' AND object_type = 'table'
  ) THEN
    PERFORM public.databricks_lakeflow_sync();
  END IF;
END
$$;

DO $$
BEGIN
  CREATE EVENT TRIGGER databricks_lakeflow_sync_before ON ddl_command_start
    WHEN TAG IN ('ALTER TABLE')
    EXECUTE FUNCTION public.databricks_lakeflow_before_ddl();
EXCEPTION WHEN duplicate_object THEN
  NULL;
END
$$;

DO $$
BEGIN
  CREATE EVENT TRIGGER databricks_lakeflow_sync ON ddl_command_end
    WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO', 'ALTER TABLE')
    EXECUTE FUNCTION public.databricks_lakeflow_on_ddl();
EXCEPTION WHEN duplicate_object THEN
  NULL;
END
$$;

SELECT public.databricks_lakeflow_sync();
