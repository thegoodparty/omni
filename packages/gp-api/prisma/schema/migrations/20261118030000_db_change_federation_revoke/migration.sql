-- db_change holds whole-row copies of captured tables, so a column-level
-- grant on the source table does not protect it here.
REVOKE SELECT ON TABLE public.db_change FROM databricks_federation;
