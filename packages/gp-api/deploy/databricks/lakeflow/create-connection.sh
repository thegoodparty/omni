#!/usr/bin/env bash
# Creates the Unity Catalog connection the Lakeflow gateway reads gp-api's
# Postgres through (bundles cannot create connections). The replication
# password is resolved inside Databricks from the secret the DB admin wrote in
# README step 3, so it never reaches this machine.
set -euo pipefail

target=${1:?usage: create-connection.sh dev|prod}
case "$target" in
  dev) host=gp-api-db.cluster-cmb1uukjsfbe.us-west-2.rds.amazonaws.com ;;
  prod) host=gp-api-db-prod.cluster-cmb1uukjsfbe.us-west-2.rds.amazonaws.com ;;
  *) echo "unknown target: $target" >&2 && exit 1 ;;
esac
warehouse_id=${DATABRICKS_WAREHOUSE_ID:-18583d8b081c6486}

# The gateway's JVM does not trust the RDS CA, so the connection carries it.
ca=$(
  curl -fsS https://truststore.pki.rds.amazonaws.com/us-west-2/us-west-2-bundle.pem
)

statement="CREATE CONNECTION gp_api_${target}_lakeflow TYPE postgresql
OPTIONS (
  host '$host',
  port '5432',
  user 'databricks_lakeflow',
  password secret('gp-api-lakeflow-$target', 'postgres-password'),
  userProvidedServerCertificate '$ca'
)
COMMENT 'gp-api Postgres for the Lakeflow mirror (deploy/databricks/lakeflow)'"

jq -n --arg warehouse_id "$warehouse_id" --arg statement "$statement" \
  '{warehouse_id: $warehouse_id, statement: $statement, wait_timeout: "50s"}' |
  databricks api post /api/2.0/sql/statements --json @/dev/stdin |
  jq '{state: .status.state, error: .status.error.message}'
