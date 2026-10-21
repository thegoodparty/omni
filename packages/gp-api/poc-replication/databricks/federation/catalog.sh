#!/usr/bin/env bash
# Path A, Databricks WORKSPACE admin (CREATE CONNECTION and CREATE CATALOG on
# the metastore). Stores the federation login in a secret scope, then creates
# the Unity Catalog connection, the foreign catalog over the whole gp_api_poc
# database and the grants, and runs smoke queries. Run it after ncc.sh reports
# connection_state=ESTABLISHED.
#
#   DOMAIN_NAME=$(pulumi stack output federationDomainName) \
#   FEDERATION_PASSWORD=<the value sql/federation/001_federation_reader.sql set> \
#   ./databricks/federation/catalog.sh
#
# Safe to re-run: existing objects are kept, secrets and grants are re-applied.
set -euo pipefail

: "${DOMAIN_NAME:?pulumi stack output federationDomainName}"
: "${FEDERATION_PASSWORD:?the password sql/federation/001_federation_reader.sql set}"
WAREHOUSE_ID=${WAREHOUSE_ID:-18583d8b081c6486}
REGION=${REGION:-us-west-2}
ENGINEER=${ENGINEER:-swain@goodparty.org}
GP_API_SP_APPLICATION_ID=e967b22e-3ec1-491e-8074-9e3dadeab666
SCOPE=gp-api-poc-replication
CONNECTION=gp_api_pg_poc
CATALOG=gp_api_pg_poc

run_sql() {
  local result state
  result=$(databricks api post /api/2.0/sql/statements --json "$(jq -n \
    --arg w "$WAREHOUSE_ID" --arg s "$1" \
    '{warehouse_id: $w, statement: $s, wait_timeout: "50s", on_wait_timeout: "CANCEL"}')")
  state=$(jq -r '.status.state' <<<"$result")
  echo "$(head -c 70 <<<"${1//$'\n'/ }") -> $state $(jq -r '.status.error.message // "" | .[0:300]' <<<"$result")"
  [[ "$state" == SUCCEEDED ]] || return 1
  jq -c '.result.data_array // empty' <<<"$result"
}

if ! databricks secrets list-scopes -o json | jq -e --arg s "$SCOPE" '.[] | select(.name == $s)' >/dev/null; then
  databricks secrets create-scope "$SCOPE"
fi
databricks secrets put-secret "$SCOPE" federation-user --string-value databricks_federation
printf '%s' "$FEDERATION_PASSWORD" | databricks secrets put-secret "$SCOPE" federation-password

# Aurora's certificate chains to the regional RDS root CA, which is not in a
# default JVM trust store. Pass the one root the cluster uses (rds-ca-rsa2048-g1).
BUNDLE=$(mktemp)
curl -fsSL "https://truststore.pki.rds.amazonaws.com/${REGION}/${REGION}-bundle.pem" -o "$BUNDLE"
SERVER_CA=""
cert=""
while IFS= read -r line; do
  cert+="$line"$'\n'
  if [[ "$line" == *"END CERTIFICATE"* ]]; then
    if openssl x509 -noout -subject <<<"$cert" | grep -q "Root CA RSA2048 G1"; then
      SERVER_CA=$cert
    fi
    cert=""
  fi
done <"$BUNDLE"
rm -f "$BUNDLE"
[[ -n "$SERVER_CA" ]] || { echo "RDS RSA2048 G1 root not found in the ${REGION} bundle" >&2; exit 1; }

run_sql "CREATE CONNECTION IF NOT EXISTS ${CONNECTION} TYPE postgresql
OPTIONS (
  host '${DOMAIN_NAME}',
  port '5432',
  user secret('${SCOPE}', 'federation-user'),
  password secret('${SCOPE}', 'federation-password'),
  userProvidedServerCertificate '${SERVER_CA}'
)"
run_sql "CREATE FOREIGN CATALOG IF NOT EXISTS ${CATALOG} USING CONNECTION ${CONNECTION}
OPTIONS (database 'gp_api_poc')"
run_sql "COMMENT ON CATALOG ${CATALOG} IS 'gp-api replication POC, path A (Lakehouse Federation over the POC Aurora cluster). Drop after the POC.'"
run_sql "GRANT USE CATALOG, USE SCHEMA, SELECT ON CATALOG ${CATALOG} TO \`${ENGINEER}\`"
run_sql "GRANT USE CATALOG, USE SCHEMA, SELECT ON CATALOG ${CATALOG} TO \`${GP_API_SP_APPLICATION_ID}\`"
run_sql "REFRESH FOREIGN SCHEMA ${CATALOG}.public"
run_sql "SELECT count(*) FROM ${CATALOG}.public.replication_probe"
run_sql "SELECT count(*) FROM ${CATALOG}.public.campaign"
echo "Bench target: --target ${CATALOG}.public"
