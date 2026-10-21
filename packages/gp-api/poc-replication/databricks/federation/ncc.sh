#!/usr/bin/env bash
# Path A, Databricks ACCOUNT admin. Adds a private endpoint rule for the POC
# VPC endpoint service to the workspace's network connectivity configuration
# (NCC), creating and attaching an NCC only if the workspace has none. A
# workspace has at most one NCC, so attaching a new one would drop any rules
# it already relies on; this script never replaces an attached NCC.
#
#   ENDPOINT_SERVICE=$(pulumi stack output federationEndpointServiceName) \
#   DOMAIN_NAME=$(pulumi stack output federationDomainName) \
#   ./databricks/federation/ncc.sh
#
# Needs a databricks CLI profile for the account console
# (https://accounts.cloud.databricks.com) passed as DATABRICKS_ACCOUNT_PROFILE.
set -euo pipefail

: "${ENDPOINT_SERVICE:?pulumi stack output federationEndpointServiceName}"
: "${DOMAIN_NAME:?pulumi stack output federationDomainName}"
: "${DATABRICKS_ACCOUNT_PROFILE:?databricks CLI profile for the account console}"
WORKSPACE_ID=${WORKSPACE_ID:-3578414625112071}
REGION=${REGION:-us-west-2}

dbx() { databricks --profile "$DATABRICKS_ACCOUNT_PROFILE" "$@"; }

NCC_ID=$(dbx account workspaces get "$WORKSPACE_ID" -o json |
  jq -r '.network_connectivity_config_id // empty')

if [[ -z "$NCC_ID" ]]; then
  NCC_ID=$(dbx account network-connectivity create-network-connectivity-configuration \
    gp-poc-replication "$REGION" -o json | jq -r '.network_connectivity_config_id')
  echo "Created NCC $NCC_ID"
  dbx account workspaces update "$WORKSPACE_ID" \
    --network-connectivity-config-id "$NCC_ID" \
    --update-mask network_connectivity_config_id
  echo "Attached NCC $NCC_ID to workspace $WORKSPACE_ID"
else
  echo "Workspace $WORKSPACE_ID already uses NCC $NCC_ID; adding the rule to it"
fi

RULE_ID=$(dbx account network-connectivity list-private-endpoint-rules "$NCC_ID" -o json |
  jq -r --arg svc "$ENDPOINT_SERVICE" '[.[] | select(.endpoint_service == $svc)][0].rule_id // empty')

if [[ -z "$RULE_ID" ]]; then
  RULE_ID=$(dbx account network-connectivity create-private-endpoint-rule "$NCC_ID" \
    --json "$(jq -n --arg svc "$ENDPOINT_SERVICE" --arg domain "$DOMAIN_NAME" \
      '{endpoint_service: $svc, domain_names: [$domain]}')" -o json | jq -r '.rule_id')
  echo "Created private endpoint rule $RULE_ID"
fi

for _ in $(seq 1 60); do
  RULE=$(dbx account network-connectivity get-private-endpoint-rule "$NCC_ID" "$RULE_ID" -o json)
  STATE=$(jq -r '.connection_state // empty' <<<"$RULE")
  VPCE_ID=$(jq -r '.vpc_endpoint_id // empty' <<<"$RULE")
  if [[ -n "$VPCE_ID" && "$STATE" != "CREATING" ]]; then break; fi
  sleep 10
done

echo "NCC_ID=$NCC_ID"
echo "RULE_ID=$RULE_ID"
echo "VPC_ENDPOINT_ID=$VPCE_ID"
echo "connection_state=$STATE"
echo "Next (AWS admin): accept VPC endpoint $VPCE_ID on the endpoint service, then re-run this script until connection_state=ESTABLISHED."
