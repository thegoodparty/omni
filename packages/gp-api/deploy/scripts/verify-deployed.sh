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
#   * serving the commit                                   -> exit 0
#   * ECS never started a task for the deployment          -> exit 1, control-plane stall
#   * tasks started and did not become healthy             -> exit 1, look at the logs
#   * no deployment references the revision at all         -> exit 1, update never landed
#   * the state could not be read                          -> exit 0, a warning
#
# The last one deliberately does not fail the job. A lost diagnostic is not
# evidence about the commit, and failing on it would turn a green promote red
# during the same control-plane stall this exists to explain. That covers an
# unreadable task definition as well as an unreadable service: a tag this cannot
# read is reported as unreadable, never as a revision that differs, because
# every deployment would then fail to match and a service that is serving the
# commit would be reported as not serving it. Run it after the deploy step with
# `if: always()` so a timed-out deploy is followed by a statement of what prod
# is running.
#
# Every verdict is scoped to the deployment under test: its own taskDefinition,
# rolloutState and task counts, and the tasks ECS started for it (`startedBy`).
# The service's `events` are service-wide, so a task replaced on the old
# deployment after the new one was created says "has started 1 tasks" and would
# read as a control-plane stall being this commit's fault; they are not evidence.
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

# The last thing the AWS CLI said on stderr, for a warning that names the cause.
api_said() { tr -d '\n' <"$err_file" | cut -c1-400; }

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
  echo "  the ECS API said: $(api_said)"
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
    --query 'taskDefinition.containerDefinitions[0].image' --output text 2>"$err_file") || return 1
  [ -n "$img" ] && [ "$img" != "None" ] || return 1
  printf '%s\n' "${img##*:}"
}

configured_td=$(jq -r '.td // empty' <<<"$svc")
[ -n "$configured_td" ] || fail "ECS returned no service $service in cluster $cluster."

primary=$(jq -c '[(.deployments // [])[] | select(.status == "PRIMARY")][0] // empty' <<<"$svc")
[ -n "$primary" ] || fail "ECS reports no PRIMARY deployment for $cluster/$service."

# Resolve every tag a verdict depends on, before reading one: a failed tag read
# is an unreadable ECS, and a partial tag map is how "unknown" used to leak into
# the comparison. Keyed by task definition ARN, which deployments share.
tagmap='{}'
unreadable=''
while IFS= read -r td; do
  [ -n "$td" ] || continue
  if tag=$(image_tag "$td"); then
    tagmap=$(jq -c --arg td "$td" --arg tag "$tag" '. + {($td): $tag}' <<<"$tagmap")
  else
    unreadable="${unreadable}${unreadable:+, }${td##*/}"
    echo "  could not read the image tag of ${td##*/}: $(api_said)"
  fi
done < <(jq -r '[.td // empty, (.deployments // [])[].td // empty] | unique[]' <<<"$svc")

if [ -n "$unreadable" ]; then
  echo "::warning::Could not read the image tag of $unreadable, so whether $sha is serving is unknown. An unreadable task definition is an unreadable ECS (a throttle, a 503 or a denied call), not a deployment of a different revision, and it does not change this job's outcome."
  echo "  Verify by hand once the ECS API answers:"
  echo "  aws ecs describe-task-definition --task-definition ${configured_td:-<task-definition>} --region $region"
  exit 0
fi

tag_of() { jq -r --arg td "$1" '.[$td] // "unknown"' <<<"$tagmap"; }

p_id=$(jq -r '.id' <<<"$primary")
p_td=$(jq -r '.td' <<<"$primary")
p_rollout=$(jq -r '.rollout // "unknown"' <<<"$primary")
p_desired=$(jq -r '.desired // 0' <<<"$primary")
p_running=$(jq -r '.running // 0' <<<"$primary")
p_pending=$(jq -r '.pending // 0' <<<"$primary")
p_tag=$(tag_of "$p_td")

echo "$cluster/$service"
echo "  promoted commit            : $sha"
echo "  configured task definition : ${configured_td##*/} (gp-api:$(tag_of "$configured_td"))"
echo "  PRIMARY deployment         : $p_id, rolloutState $p_rollout, $p_running/$p_desired tasks ($p_pending pending)"
echo "  PRIMARY task definition    : ${p_td##*/} (gp-api:$p_tag)"

# What traffic is actually on, for the failure message: the deployment ECS
# reports as COMPLETED with tasks running, which is not necessarily PRIMARY.
serving=$(jq -c '[(.deployments // [])[] | select(.rollout == "COMPLETED" and (.running // 0) > 0)][0] // empty' <<<"$svc")
if [ -n "$serving" ]; then
  serving_desc="gp-api:$(tag_of "$(jq -r '.td' <<<"$serving")") in $(jq -r '.id' <<<"$serving")"
else
  serving_desc="no COMPLETED deployment with a running task"
fi

# Serving the commit means the deployment the service is on runs the promoted
# image and has a task up. Not `running == desired`: autoscaling owns
# `desiredCount` (Pulumi `ignoreChanges` it), so a scale-out, or one task
# mid-replacement, leaves the two unequal while the service is healthy — and a
# control plane that is merely slow to report COMPLETED is not a failed promote
# either. The counts are printed and the lag is called out, not gated on.
if [ "$p_tag" = "$sha" ] && [ "${p_running:-0}" -gt 0 ]; then
  echo "  $service is serving $sha"
  if [ "$p_rollout" != "COMPLETED" ] || [ "${p_running:-0}" -ne "${p_desired:-0}" ]; then
    echo "::warning::ECS reports rolloutState $p_rollout and $p_running/$p_desired tasks for $p_id. The promoted revision is running, so the promote landed and this is the rollout state lagging behind it (a scale-out, a replaced task, or a slow control plane)."
  fi
  exit 0
fi

# Which deployment is the promoted commit's? Normally PRIMARY. When the wait
# timed out, the service can still be serving the previous revision while the
# promoted one sits in another deployment, and when the update never reached ECS
# there is no deployment for it at all.
stuck_json=""
while IFS= read -r candidate; do
  [ "$(tag_of "$(jq -r '.td' <<<"$candidate")")" = "$sha" ] || continue
  stuck_json="$candidate"
  break
done < <(jq -c '(.deployments // [])[]' <<<"$svc")

if [ -z "$stuck_json" ]; then
  echo "  No deployment of $service references the revision for $sha, so the service was never"
  echo "  updated to it: the task definition exists but nothing points ECS at it."
  fail "$cluster/$service is NOT serving $sha: no deployment for that revision. Traffic is on $serving_desc."
fi

s_id=$(jq -r '.id' <<<"$stuck_json")
s_td=$(jq -r '.td' <<<"$stuck_json")
s_rollout=$(jq -r '.rollout // "unknown"' <<<"$stuck_json")
s_desired=$(jq -r '.desired // 0' <<<"$stuck_json")
s_running=$(jq -r '.running // 0' <<<"$stuck_json")
s_pending=$(jq -r '.pending // 0' <<<"$stuck_json")
s_created=$(jq -r '.created // "unknown"' <<<"$stuck_json")

echo "  promoted deployment        : $s_id, created $s_created, rolloutState $s_rollout, $s_running/$s_desired tasks ($s_pending pending)"

# Did ECS start a task for THIS deployment? A task's `startedBy` is the id of the
# deployment that started it, so this is the one deployment-scoped answer to
# that question. Its running and pending tasks are counted per deployment
# already; STOPPED is what the deployment's own record cannot tell us, and a
# task that started and then stopped is exactly the crash-on-boot signature.
tasks_read="ok"
started_count=0
if tasks=$(aws ecs list-tasks --cluster "$cluster" --service-name "$service" \
  --started-by "$s_id" --desired-status STOPPED --region "$region" \
  --query 'taskArns' --output json 2>"$err_file"); then
  started_count=$(jq -r 'if type == "array" then length else 0 end' <<<"${tasks:-[]}" 2>/dev/null) || started_count=0
  case "$started_count" in '' | *[!0-9]*) started_count=0 ;; esac
else
  tasks_read="failed"
fi

evidence=''
[ "${s_running:-0}" -gt 0 ] && evidence="$s_running task(s) of it running now"
[ "${s_pending:-0}" -gt 0 ] && evidence="${evidence}${evidence:+, }$s_pending of it pending"
[ "${started_count:-0}" -gt 0 ] && evidence="${evidence}${evidence:+, }$started_count stopped task(s) that it started"
[ "$s_rollout" = "FAILED" ] && evidence="${evidence}${evidence:+, }ECS marking the deployment FAILED (it stops a rollout only after its tasks fail health checks or the circuit breaker reverts them)"

if [ -n "$evidence" ]; then
  echo "  Tasks for this deployment did start and did not become healthy within the wait:"
  echo "  $evidence."
  echo "  That is the commit's problem, not a control-plane stall. Read their CloudWatch logs"
  echo "  before assuming the image is bad: /sst/cluster/$cluster/$service/$service."
elif [ "$tasks_read" = "failed" ]; then
  echo "  ECS reports no task of this deployment running, pending or FAILED, but the tasks it"
  echo "  started could not be listed ($(api_said)), so one that started and stopped cannot be"
  echo "  ruled out. That is the difference between a control-plane stall and this commit"
  echo "  failing health checks, and this run cannot tell you which. Check by hand:"
  echo "  aws ecs list-tasks --cluster $cluster --service-name $service --started-by $s_id --desired-status STOPPED --region $region"
else
  echo "  ECS accepted the update but never started a task for it: no task of this deployment is"
  echo "  running or pending, none it started has stopped, and it is not FAILED. That is a"
  echo "  control-plane stall, not a bad image, an OOM or a failed health check."
  latest=$(jq -r '[.events[]?] | sort_by(.at) | last // empty | "\(.at // "?") \(.msg // "")"' <<<"$svc")
  if [ -n "$latest" ]; then
    echo "  The service's newest event (service-wide, so not proof either way): $latest"
  fi
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
