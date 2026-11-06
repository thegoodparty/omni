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
# Three outcomes, not two. A read that did not happen is UNVERIFIED, never a
# FAIL: on 2026-11-06 ECS in us-west-2 answered 503 across the whole prod verify
# and this script reported six components missing while every one of them was
# running the promoted commit. UNVERIFIED still exits non-zero — prod was not
# checked, so the stage must not pass — but it says that, instead of asserting a
# regression the release did not cause.
#
# Usage: ci-verify-deployed.sh <env> <sha>
set -uo pipefail

env="${1:?usage: ci-verify-deployed.sh <env> <sha>}"
sha="${2:?usage: ci-verify-deployed.sh <env> <sha>}"
region="${AWS_REGION:-us-west-2}"
fails=0
unverified_count=0

ok()   { printf '  ok    %-34s %s\n' "$1" "$2"; }
bad()  { printf '  FAIL  %-34s %s\n' "$1" "$2"; echo "::error::$1: $2"; fails=$((fails+1)); }
unverified() {
  printf '  UNVERIFIED  %-28s %s\n' "$1" "$2"
  echo "::error::$1: could not be read from ECS, so it is unverified — $2"
  unverified_count=$((unverified_count+1))
}

# --- reading ECS -------------------------------------------------------------
# Every call below is a control-plane read, and those fail transiently. This
# script used to carry `2>/dev/null` on each one, which made a transient failure
# indistinguishable from an answer: an empty result became "no ACTIVE task
# definition", a missing image became "latest revision is ,", and a failed
# describe-services became "could not read PRIMARY deployment". All three read
# as statements about prod. They were statements about ECS. Retry first, and
# only report UNVERIFIED once the retries are spent.
#
# Backoff is overridable only so the fixture test runs in seconds instead of
# spending a minute asleep; CI leaves both at their defaults.
ecs_attempts="${ECS_ATTEMPTS:-4}"
ecs_backoff="${ECS_BACKOFF_SECONDS:-2}"
# Every call is made as `x=$(ecs_read <subcommand> ...)`, and a $( ) call site
# cannot see a variable the function set. The failure text therefore travels
# through a file, because losing it is exactly the bug being fixed here.
ecs_err_file="$(mktemp)"
trap 'rm -f "$ecs_err_file"' EXIT
ecs_read() {
  local attempt out
  for ((attempt = 1; attempt <= ecs_attempts; attempt++)); do
    if out=$(aws ecs "$@" 2>"$ecs_err_file"); then
      : >"$ecs_err_file"
      printf '%s' "$out"
      return 0
    fi
    if [ "$attempt" -lt "$ecs_attempts" ]; then sleep $((attempt * ecs_backoff)); fi
  done
  return 1
}
# The text of the last failed read: the difference between "broker is not
# deployed" and "ECS refused to say".
ecs_last_error() {
  local text
  text=$(tr '\n' ' ' <"$ecs_err_file" 2>/dev/null | tr -s ' ')
  text="${text# }"
  text="${text% }"
  printf '%s' "${text:-no output from aws}"
}

# --- ECS service: broker -----------------------------------------------------
# Checks the PRIMARY deployment, not the service's configured task definition,
# and requires rolloutState COMPLETED. A rolled-back deployment leaves the
# service healthy on the previous revision, which the naive check would pass.
svc="broker-$env"
# The apply does not wait for the rollout, so poll here. A FAILED rollout
# (circuit breaker) stops the wait at once; anything else is given
# ROLLOUT_WAIT_SECONDS (default 900).
read_primary() {
  ecs_read describe-services --cluster "$svc" --services "$svc" --region "$region" \
    --query 'services[0].deployments[?status==`PRIMARY`]|[0].{td:taskDefinition,state:rolloutState,desired:desiredCount,running:runningCount,pending:pendingCount}' \
    --output json
}
deadline=$((SECONDS + ${ROLLOUT_WAIT_SECONDS:-900}))
primary=""
state=""
unread_reason=""
while :; do
  if now=$(read_primary); then
    primary="$now"
    state=$(jq -r '.state // empty' <<<"$now" 2>/dev/null)
    if [ "$state" = "COMPLETED" ] || [ "$state" = "FAILED" ] || [ $SECONDS -ge $deadline ]; then break; fi
    echo "  waiting: $svc rolloutState=$state $(jq -c '{desired,running,pending}' <<<"$now" 2>/dev/null)"
  else
    # Never silently: a blank `rolloutState=` in this log is what made the
    # 2026-11-06 failure unreadable. The step looked like a slow rollout when
    # ECS was refusing every call for 15 minutes straight.
    unread_reason="$(ecs_last_error)"
    if [ $SECONDS -ge $deadline ]; then break; fi
    echo "  waiting: $svc ECS did not answer: $unread_reason"
  fi
  sleep 15
done
if [ -z "$primary" ]; then
  unverified "$svc" "ECS did not answer while reading the PRIMARY deployment: ${unread_reason:-no output from aws}"
elif [ "$primary" = "null" ]; then
  # ECS answered this one, and the answer has no PRIMARY deployment in it. That
  # is a real finding about the service, unlike the empty result above.
  bad "$svc" "no PRIMARY deployment on the service (ECS answered, no rollout found)"
else
  td=$(jq -r '.td // empty' <<<"$primary")
  if [ "$state" != "COMPLETED" ]; then
    bad "$svc" "rolloutState=$state (expected COMPLETED) $(jq -c . <<<"$primary")"
    # A deployment ECS created but never started a task on is not a slow image
    # or a failing boot: its controller is not progressing it. Said out loud,
    # because desired 0 / running 0 / pending 0 otherwise reads as "mid-rollout".
    if [ "$(jq -r '.desired // -1' <<<"$primary")" = "0" ] && [ "$(jq -r '.running // -1' <<<"$primary")" = "0" ]; then
      echo "The deployment has started no task at all: ECS's deployment controller is not"
      echo "progressing it. That is an AWS-side stall, not a failed image or a failed boot."
    fi
    echo "Recent service events:"
    ecs_read describe-services --cluster "$svc" --services "$svc" --region "$region" \
      --query 'services[0].events[:10].[createdAt,message]' --output text || true
    echo "Re-running will not help if the rollout never started: terraform already"
    echo "registered the task definition, so it finds nothing to change. Force a"
    echo "new deployment: aws ecs update-service --cluster $svc --service $svc --force-new-deployment"
  elif ! img=$(ecs_read describe-task-definition --task-definition "$td" --region "$region" \
    --query 'taskDefinition.containerDefinitions[0].image' --output text); then
    unverified "$svc" "ECS did not answer while reading $td: $(ecs_last_error)"
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
  if ! arn=$(ecs_read list-task-definitions --family-prefix "$family" --status ACTIVE --sort DESC \
    --region "$region" --query 'taskDefinitionArns[0]' --output text); then
    unverified "$family" "ECS did not answer while listing task definitions: $(ecs_last_error)"
    return
  fi
  # Now only a genuine answer reaches here: ECS returned its ACTIVE list and it
  # is empty. A 503 cannot make this line fire any more.
  if [ -z "$arn" ] || [ "$arn" = "None" ]; then
    bad "$family" "no ACTIVE task definition"
    return
  fi
  if ! img=$(ecs_read describe-task-definition --task-definition "$arn" --region "$region" \
    --query 'taskDefinition.containerDefinitions[0].image' --output text); then
    unverified "$family" "ECS did not answer while reading $arn: $(ecs_last_error)"
    return
  fi
  if [[ "$img" != *":$expect" ]]; then
    bad "$family" "latest revision is $img, expected tag $expect"
  else
    ok "$family" "$expect"
  fi
}

check_taskdef "pmf-engine-$env"          "pmf-engine-$sha"
check_taskdef "serve-analyze-$env"       "serve-analyze-$sha"
check_taskdef "ddhq-matcher-$env"        "ddhq-matcher-$sha"
check_taskdef "autopilot-agent-$env"            "autopilot-agent-$sha"
check_taskdef "autopilot-agent-playwright-$env" "autopilot-agent-playwright-$sha"

echo
if [ "$fails" -ne 0 ]; then
  echo "::error::$fails gp-ai component(s) in $env are not running $sha"
fi
if [ "$unverified_count" -ne 0 ]; then
  # Red, because prod was not verified. Worded so nobody reads it as a
  # regression: on 2026-11-06 six components were reported missing while every
  # one of them was on the promoted commit, and the ticket said so.
  echo "::error::$unverified_count gp-ai component(s) in $env could not be read from ECS, so prod is unverified. That is not evidence that prod is wrong — check ECS and re-run the verify."
fi
if [ "$fails" -ne 0 ] || [ "$unverified_count" -ne 0 ]; then
  exit 1
fi
echo "all gp-ai components in $env are running $sha"
