-- Prints Databricks SQL, one statement per line: a view in
-- goodparty_data_catalog.gp_api_mirror_lakeflow_read for every table in the
-- lakeflow_gp_api_poc publication. Run with psql -At against gp_api_poc and
-- execute the output on a SQL warehouse (README B.7). Re-run after migrations.
--
-- Lakeflow lands PostgreSQL uuid as BINARY and timestamp without time zone
-- (every Prisma DateTime) as STRING (postgresql-reference, "Automatic data
-- transformations"). The views turn them back into uuid text and TIMESTAMP_NTZ
-- and pass every other column through. The uuid expression handles 16 raw
-- bytes, the uuid text as bytes, and STRING, whichever actually lands.
-- WITH SCHEMA EVOLUTION lets SELECT * pick up columns added after the view.

\set ON_ERROR_STOP 1

WITH cols AS (
  SELECT t.tablename,
    a.attname,
    a.attnum,
    format_type(a.atttypid, NULL) AS pg_type,
    '`' || replace(a.attname, '`', '``') || '`' AS col
  FROM pg_publication_tables t
  JOIN pg_attribute a
    ON a.attrelid = format('%I.%I', t.schemaname, t.tablename)::regclass
  WHERE t.pubname = 'lakeflow_gp_api_poc'
    AND t.schemaname = 'public'
    AND a.attnum > 0
    AND NOT a.attisdropped
),
converted AS (
  SELECT tablename,
    string_agg(col, ', ' ORDER BY attnum) AS except_list,
    string_agg(
      CASE pg_type
        WHEN 'uuid' THEN
          'CASE WHEN octet_length(' || col || ') = 16 THEN lower(concat_ws(''-'', '
          || 'substr(hex(' || col || '), 1, 8), substr(hex(' || col || '), 9, 4), '
          || 'substr(hex(' || col || '), 13, 4), substr(hex(' || col || '), 17, 4), '
          || 'substr(hex(' || col || '), 21, 12))) ELSE lower(CAST(' || col
          || ' AS STRING)) END AS ' || col
        ELSE 'try_cast(' || col || ' AS TIMESTAMP_NTZ) AS ' || col
      END,
      ', ' ORDER BY attnum
    ) AS select_list
  FROM cols
  WHERE pg_type IN ('uuid', 'timestamp without time zone')
  GROUP BY tablename
)
SELECT 'CREATE OR REPLACE VIEW goodparty_data_catalog.gp_api_mirror_lakeflow_read.`'
  || replace(p.tablename, '`', '``')
  || '` WITH SCHEMA EVOLUTION AS SELECT '
  || CASE WHEN c.tablename IS NULL THEN '*'
     ELSE '* EXCEPT (' || c.except_list || '), ' || c.select_list END
  || ' FROM goodparty_data_catalog.gp_api_mirror_lakeflow.`'
  || replace(p.tablename, '`', '``') || '`'
FROM pg_publication_tables p
LEFT JOIN converted c ON c.tablename = p.tablename
WHERE p.pubname = 'lakeflow_gp_api_poc' AND p.schemaname = 'public'
ORDER BY p.tablename;
