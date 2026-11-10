#!/usr/bin/env bash
# Report what the gp-api ECS service is actually running, and whether it is the
# commit the release train just promoted. ENG-11609.
#
# `Deploy (Pulumi)` is not that report. service.ts waits for ECS steady state
# under a 10-minute timeout, and Pulumi writes the service's new spec before it
# waits, so a timed-out wait leaves the stack pointing at a task definition that
# ECS never scheduled a task for. On 2026-11-06 that is exactly what happened:
# prod was configured with :1240, served :1239, and the wait said
#
#   timeout while waiting for state to become 'tfSTABLE' (last state:
#   'tfPENDING', timeout: 10m0s): provider=aws@6.67.0
#
# which is also what a genuine crash-on-boot says. The train could not tell "a
# human must recover this" from "this commit is bad", so it took a person
# reading ECS by hand and pressing re-run twice (runs 42307299663,
# 42323010486, 42325220761).
#
# This reads the deployed state and separates the two worlds:
#
#   * serving the commit                                  -> exit 0
#   * ECS never scheduled a task for the deployment       -> exit 1, control-plane stall
#   * tasks started and did not become healthy            -> exit 1, look at the logs
#   * no deployment references the revision at all         -> exit 1, the update never landed
#   * ECS could not be read                               -> exit 0, a warning
#
# The last one deliberately does not fail the job. A lost diagnostic is not
# evidence about the commit, and failing on it would turn a green promote red
# during the same control-plane stall this exists to explain. Run it after the
# deploy step with `if: always()` so a timed-out deploy is followed by a
# statement of what prod is running.
#
# Reads only AWS APIs, so it needs no reachability into the VPC.
#
# Usage: verify-deployed.sh <cluster> <service> <sha>
set -uo pipefail

cluster="${1:?usage: verify-deployed.sh <cluster> <service> <sha>}"
service="${2:?usage: verify-deployed.sh <cluster> <service> <sha>}"
sha="${3:?usage: verify-deployed.sh <cluster> <service> <sha>}"
region="${AWS_REGION:-us-west-2}"

fail() { echo "::error::$*"; exit 1; }

err_file=$(mktemp)
trap 'rm -f "$err_file"' EXIT

# Three attempts, not a wait: the deployment has already had the whole length of
# Pulumi's timeout, so this is about a flaky read, not about giving the rollout
# more time. During ENG-11609 the ECS API answered 503 for over 50 minutes, which
# no number of retries here would have outlasted.
svc=""
for attempt in 1 2 3; do
  if svc=$(aws ecs describe-services --cluster "$cluster" --services "$service" \
    --region "$region" \
    --query 'services[0].{td:taskDefinition,desired:desiredCount,running:runningCount,pending:pendingCount,deployments:deployments[].{id:id,td:taskDefinition,status:status,rollout:rolloutState,desired:desiredCount,running:runningCount,pending:pendingCount,created:createdAt},events:events[:100].{at:createdAt,msg:message}}' \
    --output json 2>"$err_file") && [ -n "$svc" ] && [ "$svc" != "null" ]; then
    break
  fi
  svc=""
  echo "  attempt $attempt/3: could not read $cluster/$service: $(tr -d '\n' <"$err_file" | cut -c1-200)"
  [ "$attempt" -eq 3 ] || sleep "${VERIFY_RETRY_DELAY:-5}"
done
if [ -z "$svc" ]; then
  echo "  the ECS API said: $(tr -d '\n' <"$err_file" | cut -c1-400)"
  echo "::warning::Could not read $cluster/$service, so whether $sha is serving is unknown. This is an AWS condition (a 503 ServiceUnavailableException in particular), not evidence about the commit, and it does not change this job's outcome."
  echo "  Verify by hand, or press re-run once the ECS API answers again:"
  echo "  aws ecs describe-services --cluster $cluster --services $service --region $region"
  exit 0
fi

# ECR tags the image with the commit SHA (`IMAGE_URI` in release.yml), so the tag
# on the running task definition is the deployed commit.
image_tag() {
  local td="$1" img
  img=$(aws ecs describe-task-definition --task-definition "$td" --region "$region" \
    --query 'taskDefinition.containerDefinitions[0].image' --output text 2>/dev/null) || return 1
  [ -n "$img" ] && [ "$img" != "None" ] || return 1
  printf '%s\n' "${img##*:}"
}

configured_td=$(jq -r '.td // empty' <<<"$svc")
[ -n "$configured_td" ] || fail "ECS returned no service $service in cluster $cluster."

primary=$(jq -c '[.deployments[] | select(.status == "PRIMARY")][0] // empty' <<<"$svc")
[ -n "$primary" ] || fail "ECS reports no PRIMARY deployment for $cluster/$service."

p_id=$(jq -r '.id' <<<"$primary")
p_td=$(jq -r '.td' <<<"$primary")
p_rollout=$(jq -r '.rollout // "unknown"' <<<"$primary")
p_desired=$(jq -r '.desired' <<<"$primary")
p_running=$(jq -r '.running' <<<"$primary")
p_pending=$(jq -r '.pending' <<<"$primary")
p_tag=$(image_tag "$p_td" || echo unknown)

echo "$cluster/$service"
echo "  promoted commit            : $sha"
echo "  configured task definition : ${configured_td##*/} (gp-api:$(image_tag "$configured_td" || echo unknown))"
echo "  PRIMARY deployment         : $p_id, rolloutState $p_rollout, $p_running/$p_desired tasks ($p_pending pending)"
echo "  PRIMARY task definition    : ${p_td##*/} (gp-api:$p_tag)"

# What traffic is actually on, for the verdict: the deployment ECS reports as
# COMPLETED with tasks running, which is not necessarily PRIMARY.
serving=$(jq -c '[.deployments[] | select(.rollout == "COMPLETED" and .running > 0)][0] // empty' <<<"$svc")
if [ -n "$serving" ]; then
  serving_desc="gp-api:$(image_tag "$(jq -r '.td' <<<"$serving")" || echo unknown) in $(jq -r '.id' <<<"$serving")"
else
  serving_desc="no COMPLETED deployment"
fi

if [ "$p_tag" = "$sha" ] && [ "$p_rollout" = "COMPLETED" ] && [ "$p_running" = "$p_desired" ] && [ "${p_desired:-0}" -gt 0 ]; then
  echo "  $service is serving $sha"
  exit 0
fi

# Which deployment is the promoted commit's? Normally PRIMARY. When the wait
# timed out, the service can still be serving the previous revision while the
# promoted one sits in another deployment, and when the update never reached ECS
# there is no deployment for it at all.
stuck_json=""
while IFS= read -r candidate; do
  [ "$(image_tag "$(jq -r '.td' <<<"$candidate")" 2>/dev/null)" = "$sha" ] || continue
  stuck_json="$candidate"
  break
done < <(jq -c '.deployments[]' <<<"$svc")

if [ -z "$stuck_json" ]; then
  echo "  No deployment of $service references the revision for $sha, so the service was never"
  echo "  updated to it: the task definition exists but nothing points ECS at it."
  fail "$cluster/$service is NOT serving $sha: no deployment for that revision. Traffic is on $serving_desc."
fi

s_id=$(jq -r '.id' <<<"$stuck_json")
s_td=$(jq -r '.td' <<<"$stuck_json")
s_rollout=$(jq -r '.rollout // "unknown"' <<<"$stuck_json")
s_desired=$(jq -r '.desired' <<<"$stuck_json")
s_running=$(jq -r '.running' <<<"$stuck_json")
s_pending=$(jq -r '.pending' <<<"$stuck_json")
s_created=$(jq -r '.created' <<<"$stuck_json")

echo "  promoted deployment        : $s_id, created $s_created, rolloutState $s_rollout, $s_running/$s_desired tasks ($s_pending pending)"

# "Started" is ECS's own wording for scheduling tasks for a deployment. No such
# event and no running or pending task means nothing of this revision ever ran,
# so nothing could have failed a health check.
started=$(jq -r --arg at "$s_created" \
  '[.events[] | select(.at >= $at) | .msg | select(test("has started"))] | length' <<<"$svc")

if [ "$started" -eq 0 ] && [ "${s_running:-0}" -eq 0 ] && [ "${s_pending:-0}" -eq 0 ]; then
  echo "  ECS accepted the update but never scheduled a task for it: no service event since the"
  echo "  deployment was created reports a started task, and none is running or pending."
  echo "  That is a control-plane stall, not a bad image, an OOM or a failed health check."
else
  echo "  Tasks for this deployment did start ($started 'has started' event(s)) and did not become"
  echo "  healthy within the wait. Read their CloudWatch logs before assuming the image is bad:"
  echo "  /sst/cluster/$cluster/$service/$service."
fi

# Say what a re-run would do, from what the service is configured with now rather
# than from an assumption: Pulumi compares its own spec, so a spec that already
# names this revision has nothing left to change.
if [ "$configured_td" = "$s_td" ]; then
  echo "  The service is already configured with ${s_td##*/}, so Pulumi has nothing left to change:"
  echo "  re-running this job exits 0 without a rollout."
fi
echo "  Recovering needs a new task definition (a new commit) or a forced new deployment."

fail "$cluster/$service is NOT serving $sha: $s_id is $s_rollout with $s_running/$s_desired tasks. Traffic is on $serving_desc."
