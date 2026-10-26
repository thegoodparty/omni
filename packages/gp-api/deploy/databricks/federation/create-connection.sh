#!/usr/bin/env bash
# Creates the Unity Catalog connection gp_api_<env> that Lakehouse Federation
# reads gp-api's Postgres through, then hands it to the github-action service
# principal that applies gp-terraform-dataplatform (README step 4). The
# password is resolved inside Databricks from the secret stored in step 3, so
# it never reaches this machine. Safe to re-run.
set -euo pipefail

target=${1:?usage: create-connection.sh dev|prod}
case "$target" in
  dev) host=gp-api-db.cluster-cmb1uukjsfbe.us-west-2.rds.amazonaws.com ;;
  prod) host=gp-api-db-prod.cluster-cmb1uukjsfbe.us-west-2.rds.amazonaws.com ;;
  *) echo "unknown target: $target" >&2 && exit 1 ;;
esac
connection=gp_api_${target}
warehouse_id=${DATABRICKS_WAREHOUSE_ID:-18583d8b081c6486}
owner=${CONNECTION_OWNER:-a04e9e24-aac3-4308-9a65-d88fa34e444f}

run_sql() {
  local result state
  result=$(
    jq -n --arg warehouse_id "$warehouse_id" --arg statement "$1" \
      '{warehouse_id: $warehouse_id, statement: $statement, wait_timeout: "50s", on_wait_timeout: "CANCEL"}' |
      databricks api post /api/2.0/sql/statements --json @/dev/stdin
  )
  state=$(jq -r '.status.state' <<<"$result")
  echo "${1%%$'\n'*} -> $state $(jq -r '.status.error.message // ""' <<<"$result")"
  [[ "$state" == SUCCEEDED ]]
}

# Unity Catalog also says "does not exist" when the connection exists but you
# have no privilege on it. CREATE then fails with "already exists"; see the
# README's failure modes.
if info=$(databricks connections get "$connection" -o json 2>&1); then
  current_owner=$(jq -r '.owner' <<<"$info")
elif [[ "$info" == *"does not exist"* ]]; then
  current_owner=
else
  echo "$info" >&2
  exit 1
fi

if [[ -z "$current_owner" ]]; then
  # The serverless JVM does not trust the RDS CA, so the connection carries it.
  ca=$(
    curl -fsS https://truststore.pki.rds.amazonaws.com/us-west-2/us-west-2-bundle.pem
  )
  run_sql "CREATE CONNECTION $connection TYPE postgresql
OPTIONS (
  host '$host',
  port '5432',
  user 'databricks_federation',
  password secret('gp-api-federation-$target', 'postgres-password'),
  userProvidedServerCertificate '$ca'
)
COMMENT 'gp-api Postgres for Lakehouse Federation (omni deploy/databricks/federation)'"
  current_owner=$(databricks connections get "$connection" -o json | jq -r '.owner')
fi

if [[ "$current_owner" != "$owner" ]]; then
  run_sql "ALTER CONNECTION $connection OWNER TO \`$owner\`"
fi

echo "$connection is owned by $owner"
