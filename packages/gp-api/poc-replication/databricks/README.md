# Databricks side of the replication POC

Each path keeps its Databricks definitions in its own folder here: `federation/` (A), `lakeflow/` (B), `zerobus/` (C). Every table a path writes lives in `goodparty_data_catalog.poc_import_contacts` or a new `poc_import_contacts_*` schema (path A's foreign catalog is the one object outside it). The runbook steps that apply them are in `../README.md`.
