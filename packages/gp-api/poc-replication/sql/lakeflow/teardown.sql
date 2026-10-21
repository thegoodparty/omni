-- Removes everything 001_source_setup.sql created. Run as poc_admin after the
-- gateway is gone (an active slot cannot be dropped). REPLICA IDENTITY FULL is
-- left in place; it only costs WAL volume and goes with the cluster.

\set ON_ERROR_STOP 1

SET ROLE lakeflow_replication;
SELECT pg_drop_replication_slot(slot_name) FROM pg_replication_slots
WHERE slot_name = 'lakeflow_gp_api_poc';
RESET ROLE;
DROP PUBLICATION IF EXISTS lakeflow_gp_api_poc;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE SELECT ON TABLES FROM lakeflow_replication;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM lakeflow_replication;
REVOKE USAGE ON SCHEMA public FROM lakeflow_replication;
REVOKE CONNECT ON DATABASE gp_api_poc FROM lakeflow_replication;
REVOKE SELECT ON pg_catalog.pg_publication, pg_catalog.pg_replication_slots,
  pg_catalog.pg_namespace, pg_catalog.pg_class, pg_catalog.pg_attribute,
  pg_catalog.pg_type, pg_catalog.pg_index FROM lakeflow_replication;
DROP ROLE IF EXISTS lakeflow_replication;
