#!/usr/bin/env bash
# Assert the RUNNING gp-ai configuration references the expected commit.
#
# "terraform apply succeeded" does not mean the new code is running. broker sets
# deployment_circuit_breaker { rollback = true }, so a crash-on-boot image is
# rolled back by ECS, the service settles on the OLD task definition, and the
# apply still reports success. This is the check that catches that: it reads what
# is actually deployed, not what terraform intended.
#
# Reads only AWS APIs, so it needs no reachability into the VPC (broker's ALB is
# internal and a CI runner cannot reach it).
#
# Usage: ci-verify-deployed.sh <env> <sha>
set -uo pipefail

env="${1:?usage: ci-verify-deployed.sh <env> <sha>}"
sha="${2:?usage: ci-verify-deployed.sh <env> <sha>}"
region="${AWS_REGION:-us-west-2}"
fails=0

ok()   { printf '  ok    %-34s %s\n' "$1" "$2"; }
bad()  { printf '  FAIL  %-34s %s\n' "$1" "$2"; echo "::error::$1: $2"; fails=$((fails+1)); }

# --- ECS service: broker -----------------------------------------------------
# Checks the PRIMARY deployment, not the service's configured task definition,
# and requires rolloutState COMPLETED. A rolled-back deployment leaves the
# service healthy on the previous revision, which the naive check would pass.
svc="broker-$env"
primary=$(aws ecs describe-services --cluster "$svc" --services "$svc" --region "$region" \
  --query 'services[0].deployments[?status==`PRIMARY`]|[0].{td:taskDefinition,state:rolloutState}' \
  --output json 2>/dev/null)
if [ -z "$primary" ] || [ "$primary" = "null" ]; then
  bad "$svc" "could not read PRIMARY deployment"
else
  td=$(jq -r '.td // empty' <<<"$primary")
  state=$(jq -r '.state // empty' <<<"$primary")
  img=$(aws ecs describe-task-definition --task-definition "$td" --region "$region" \
    --query 'taskDefinition.containerDefinitions[0].image' --output text 2>/dev/null)
  if [ "$state" != "COMPLETED" ]; then
    bad "$svc" "rolloutState=$state (expected COMPLETED)"
  elif [[ "$img" != *":broker-$sha" ]]; then
    bad "$svc" "running $img, expected tag broker-$sha"
  else
    ok "$svc" "broker-$sha, rollout COMPLETED"
  fi
fi

# --- Task definitions with no long-running service ---------------------------
# RunTask-driven (pmf-engine runner) or invoked per-request. There is no service
# to inspect, so the newest ACTIVE revision of the family is what the next run
# will use.
check_taskdef() {
  local family="$1" expect="$2"
  local arn img
  # No --max-items: it makes the CLI append a pagination token as a SECOND line
  # of --output text, so $arn becomes "<arn>\nNone" and describe-task-definition
  # fails with "Invalid revision number". Take [0] of the DESC-sorted list instead.
  arn=$(aws ecs list-task-definitions --family-prefix "$family" --status ACTIVE --sort DESC \
    --region "$region" --query 'taskDefinitionArns[0]' --output text 2>/dev/null)
  if [ -z "$arn" ] || [ "$arn" = "None" ]; then
    bad "$family" "no ACTIVE task definition"
    return
  fi
  img=$(aws ecs describe-task-definition --task-definition "$arn" --region "$region" \
    --query 'taskDefinition.containerDefinitions[0].image' --output text 2>/dev/null)
  if [[ "$img" != *":$expect" ]]; then
    bad "$family" "latest revision is $img, expected tag $expect"
  else
    ok "$family" "$expect"
  fi
}

check_taskdef "pmf-engine-$env"          "pmf-engine-$sha"
check_taskdef "serve-analyze-$env"       "serve-analyze-$sha"
check_taskdef "ddhq-matcher-$env"        "ddhq-matcher-$sha"
check_taskdef "engineer-agent-$env"      "engineer-agent-$sha"

echo
if [ "$fails" -ne 0 ]; then
  echo "::error::$fails gp-ai component(s) are not running $sha"
  exit 1
fi
echo "all gp-ai components in $env are running $sha"
