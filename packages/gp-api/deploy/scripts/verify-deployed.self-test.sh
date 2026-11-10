#!/usr/bin/env bash
# Fixture self-test for verify-deployed.sh. A fake `aws` on PATH serves canned
# ECS responses, so every verdict is checked without AWS access or network.
#
# Usage: verify-deployed.self-test.sh
set -uo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
verify="$here/verify-deployed.sh"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

mkdir -p "$tmp/bin"
cat >"$tmp/bin/aws" <<'FAKE'
#!/usr/bin/env bash
set -uo pipefail
# describe-services and list-tasks: the script asks for --output json, so serve
# raw JSON (post --query, as the real CLI would). describe-task-definition: it
# asks for a --query with --output text, so serve the image URI.
args="$*"
td=""
while [ $# -gt 0 ]; do
  if [ "$1" = "--task-definition" ]; then td="$2"; fi
  shift
done
case "$args" in
  *"ecs describe-services"*)
    if [ -f "$FAKE_DIR/service.fail" ]; then cat "$FAKE_DIR/service.fail" >&2; exit 255; fi
    cat "$FAKE_DIR/service.json"
    ;;
  *"ecs describe-task-definition"*)
    if [ -f "$FAKE_DIR/td/${td##*:}.fail" ]; then cat "$FAKE_DIR/td/${td##*:}.fail" >&2; exit 254; fi
    cat "$FAKE_DIR/td/${td##*:}.txt"
    ;;
  *"ecs list-tasks"*)
    if [ -f "$FAKE_DIR/tasks.fail" ]; then cat "$FAKE_DIR/tasks.fail" >&2; exit 254; fi
    if [ -f "$FAKE_DIR/tasks.json" ]; then cat "$FAKE_DIR/tasks.json"; else echo '[]'; fi
    ;;
  *)
    echo "fake aws: unexpected call: $*" >&2
    exit 127
    ;;
esac
FAKE
chmod +x "$tmp/bin/aws"
export PATH="$tmp/bin:$PATH"
export VERIFY_RETRY_DELAY=0

failures=0
check() {
  local name="$1" expected_exit="$2"
  shift 2
  local out status
  out=$(bash "$verify" cluster svc "$CASE_SHA" 2>&1)
  status=$?
  if [ "$status" -ne "$expected_exit" ]; then
    echo "FAIL $name: exit $status, expected $expected_exit"
    sed 's/^/    /' <<<"$out"
    failures=$((failures + 1))
    return
  fi
  local needle
  for needle in "$@"; do
    if ! grep -qF -- "$needle" <<<"$out"; then
      echo "FAIL $name: output has no '$needle'"
      sed 's/^/    /' <<<"$out"
      failures=$((failures + 1))
      return
    fi
  done
  echo "ok   $name"
}

# A verdict must never be produced from evidence that is not deployment-scoped,
# so a case can assert that a line is *absent* too.
check_absent() {
  local name="$1"
  shift
  local out needle
  out=$(bash "$verify" cluster svc "$CASE_SHA" 2>&1)
  for needle in "$@"; do
    if grep -qF -- "$needle" <<<"$out"; then
      echo "FAIL $name: output has '$needle'"
      sed 's/^/    /' <<<"$out"
      failures=$((failures + 1))
      return
    fi
  done
  echo "ok   $name"
}

case_dir() {
  CASE_DIR="$tmp/$1"
  CASE_SHA="$2"
  mkdir -p "$CASE_DIR/td"
  export FAKE_DIR="$CASE_DIR"
}

sha=1bd63c3eb665061073287bee2f5fa5040e827d5c
img="333022194791.dkr.ecr.us-west-2.amazonaws.com/gp-api"
arn="arn:aws:ecs:us-west-2:333022194791:task-definition/gp-master-fargateCluster-gp-api-master"

# A healthy promote: Pulumi's wait returned, ECS runs the promoted revision.
case_dir serving "$sha"
printf '%s:%s' "$img" "$sha" >"$CASE_DIR/td/1257.txt"
cat >"$CASE_DIR/service.json" <<JSON
{"td":"$arn:1257",
 "desired":10,"running":10,"pending":0,
 "deployments":[{"id":"ecs-svc/9304510563921584425","td":"$arn:1257","status":"PRIMARY","rollout":"COMPLETED","desired":10,"running":10,"pending":0,"created":"2026-11-10T01:23:51.407000+00:00"}],
 "events":[{"at":"2026-11-10T01:24:00.000000+00:00","msg":"(service svc) has started 10 tasks."}]}
JSON
check "promoted revision is serving" 0 "is serving $sha"

# B3 (autoscale): autoscaling owns desiredCount, so a scale-out leaves the
# counts unequal while the service is healthy and serving the commit.
case_dir scale-out "$sha"
printf '%s:%s' "$img" "$sha" >"$CASE_DIR/td/1257.txt"
cat >"$CASE_DIR/service.json" <<JSON
{"td":"$arn:1257",
 "desired":12,"running":8,"pending":4,
 "deployments":[{"id":"ecs-svc/9304510563921584425","td":"$arn:1257","status":"PRIMARY","rollout":"COMPLETED","desired":12,"running":8,"pending":4,"created":"2026-11-10T01:23:51.407000+00:00"}],
 "events":[]}
JSON
check "a scale-out is not a stall" 0 \
  "is serving $sha" \
  "rolloutState COMPLETED and 8/12 tasks"

# B3 (one task mid-replacement): ECS takes the deployment back to IN_PROGRESS to
# relaunch a stopped task. The promoted revision is still what serves traffic.
case_dir mid-replacement "$sha"
printf '%s:%s' "$img" "$sha" >"$CASE_DIR/td/1257.txt"
cat >"$CASE_DIR/service.json" <<JSON
{"td":"$arn:1257",
 "desired":10,"running":9,"pending":1,
 "deployments":[{"id":"ecs-svc/9304510563921584425","td":"$arn:1257","status":"PRIMARY","rollout":"IN_PROGRESS","desired":10,"running":9,"pending":1,"created":"2026-11-10T01:23:51.407000+00:00"},
   {"id":"ecs-svc/1111111111111111111","td":"$arn:1257","status":"ACTIVE","rollout":"COMPLETED","desired":0,"running":0,"pending":0,"created":"2026-11-09T01:23:51.407000+00:00"}],
 "events":[{"at":"2026-11-10T01:30:00.000000+00:00","msg":"(service svc) has started 1 tasks: (task 0a1b2c)."}]}
JSON
check "one task mid-replacement is not a stall" 0 \
  "is serving $sha" \
  "is the rollout state lagging behind it"

# ENG-11609 itself: Pulumi's wait timed out and left the service configured with
# the new revision, but ECS never scheduled a task for it. The service-wide event
# stream carries a "has started" line from AFTER the deployment was created — a
# task replaced on the old deployment — which must not be read as this
# deployment starting tasks (B2). `startedBy` is empty for the new deployment.
case_dir never-started "$sha"
printf '%s:4a3e6ba0b328499921b718178f710159ac261c0e' "$img" >"$CASE_DIR/td/1239.txt"
printf '%s:%s' "$img" "$sha" >"$CASE_DIR/td/1240.txt"
printf '[]' >"$CASE_DIR/tasks.json"
cat >"$CASE_DIR/service.json" <<JSON
{"td":"$arn:1240",
 "desired":10,"running":10,"pending":0,
 "deployments":[
   {"id":"ecs-svc/0261404581972104932","td":"$arn:1240","status":"PRIMARY","rollout":"IN_PROGRESS","desired":10,"running":0,"pending":0,"created":"2026-11-06T22:45:58.533000+00:00"},
   {"id":"ecs-svc/2643059575875231771","td":"$arn:1239","status":"ACTIVE","rollout":"COMPLETED","desired":10,"running":10,"pending":0,"created":"2026-11-06T22:21:56.000000+00:00"}],
 "events":[{"at":"2026-11-06T22:47:00.000000+00:00","msg":"(service svc) has started 1 tasks: (task 9f8e7d)."},
           {"at":"2026-11-06T22:43:37.000000+00:00","msg":"(service svc) has reached a steady state."}]}
JSON
check "rollout that never started a task" 1 \
  "never started a task" \
  "control-plane stall, not a bad image" \
  "nothing left to change" \
  "::error::"
check_absent "a service-wide 'has started' event is not race evidence" \
  "Tasks for this deployment did start"

# Same shape, but the deployment's own tasks did run and stop: that is the
# commit's problem, and `startedBy` is what says so.
case_dir started-then-failed "$sha"
printf '%s:4a3e6ba0b328499921b718178f710159ac261c0e' "$img" >"$CASE_DIR/td/1239.txt"
printf '%s:%s' "$img" "$sha" >"$CASE_DIR/td/1240.txt"
printf '["arn:aws:ecs:us-west-2:333022194791:task/svc/0a1b2c","arn:aws:ecs:us-west-2:333022194791:task/svc/3d4e5f"]' >"$CASE_DIR/tasks.json"
cat >"$CASE_DIR/service.json" <<JSON
{"td":"$arn:1240",
 "desired":10,"running":10,"pending":0,
 "deployments":[{"id":"ecs-svc/0261404581972104932","td":"$arn:1240","status":"PRIMARY","rollout":"IN_PROGRESS","desired":10,"running":0,"pending":0,"created":"2026-11-06T22:45:58.533000+00:00"},
   {"id":"ecs-svc/2643059575875231771","td":"$arn:1239","status":"ACTIVE","rollout":"COMPLETED","desired":10,"running":10,"pending":0,"created":"2026-11-06T22:21:56.000000+00:00"}],
 "events":[{"at":"2026-11-06T22:47:00.000000+00:00","msg":"(service svc) has started 10 tasks."},
           {"at":"2026-11-06T22:49:00.000000+00:00","msg":"(service svc) has stopped 10 running tasks."}]}
JSON
check "tasks the deployment started, then stopped" 1 \
  "2 stopped task(s) that it started" \
  "did not become healthy" \
  "Read their CloudWatch logs"

# The circuit breaker reverted the rollout. ECS marks the deployment FAILED, which
# is deployment-scoped evidence on its own, so no task listing is needed.
case_dir reverted "$sha"
printf '%s:4a3e6ba0b328499921b718178f710159ac261c0e' "$img" >"$CASE_DIR/td/1239.txt"
printf '%s:%s' "$img" "$sha" >"$CASE_DIR/td/1240.txt"
printf '[]' >"$CASE_DIR/tasks.json"
cat >"$CASE_DIR/service.json" <<JSON
{"td":"$arn:1239",
 "desired":10,"running":10,"pending":0,
 "deployments":[{"id":"ecs-svc/2643059575875231771","td":"$arn:1239","status":"PRIMARY","rollout":"COMPLETED","desired":10,"running":10,"pending":0,"created":"2026-11-06T22:21:56.000000+00:00"},
   {"id":"ecs-svc/0261404581972104932","td":"$arn:1240","status":"ACTIVE","rollout":"FAILED","desired":10,"running":0,"pending":0,"created":"2026-11-06T22:45:58.533000+00:00"}],
 "events":[]}
JSON
check "circuit breaker reverted the rollout" 1 \
  "ECS marking the deployment FAILED" \
  "did not become healthy"

# The task listing itself fails. The stall/crash split then cannot be made, and
# the run must say so rather than pick one.
case_dir tasks-unreadable "$sha"
printf '%s:4a3e6ba0b328499921b718178f710159ac261c0e' "$img" >"$CASE_DIR/td/1239.txt"
printf '%s:%s' "$img" "$sha" >"$CASE_DIR/td/1240.txt"
cat >"$CASE_DIR/tasks.fail" <<'ERR'
An error occurred (ServiceUnavailableException) when calling the ListTasks operation: 503 Service Unavailable
ERR
cat >"$CASE_DIR/service.json" <<JSON
{"td":"$arn:1240",
 "desired":10,"running":10,"pending":0,
 "deployments":[
   {"id":"ecs-svc/0261404581972104932","td":"$arn:1240","status":"PRIMARY","rollout":"IN_PROGRESS","desired":10,"running":0,"pending":0,"created":"2026-11-06T22:45:58.533000+00:00"},
   {"id":"ecs-svc/2643059575875231771","td":"$arn:1239","status":"ACTIVE","rollout":"COMPLETED","desired":10,"running":10,"pending":0,"created":"2026-11-06T22:21:56.000000+00:00"}],
 "events":[]}
JSON
check "unreadable task listing does not claim a stall" 1 \
  "could not be listed" \
  "cannot tell you which"
check_absent "unreadable task listing does not claim a stall, part 2" \
  "control-plane stall, not a bad image"

# The update never reached ECS, so no deployment references the revision.
case_dir never-updated "$sha"
printf '%s:831b5f08556059dc201d98063d26b50c403b4577' "$img" >"$CASE_DIR/td/1257.txt"
cat >"$CASE_DIR/service.json" <<JSON
{"td":"$arn:1257",
 "desired":10,"running":10,"pending":0,
 "deployments":[{"id":"ecs-svc/9304510563921584425","td":"$arn:1257","status":"PRIMARY","rollout":"COMPLETED","desired":10,"running":10,"pending":0,"created":"2026-11-10T01:23:51.407000+00:00"}],
 "events":[]}
JSON
check "no deployment for the revision" 1 "No deployment of svc references the revision" "::error::"

# The control plane is unreadable. That is an AWS condition, not a verdict on the
# commit: the job's outcome must not change because a diagnostic went missing.
case_dir unreadable "$sha"
cat >"$CASE_DIR/service.fail" <<'ERR'
An error occurred (ServiceUnavailableException) when calling the DescribeServices operation: 503 Service Unavailable
ERR
check "ECS API unavailable does not fail the job" 0 \
  "::warning::Could not read" \
  "not evidence about the commit" \
  "does not change this job's outcome"

# B1: a throttled or denied describe-task-definition is an unreadable ECS, not a
# deployment of a different revision. Reading it as "unknown" made every
# deployment fail to match and reported a service that WAS serving $sha as not
# serving it — a false red on a good promote.
case_dir tag-unreadable "$sha"
printf '%s:%s' "$img" "$sha" >"$CASE_DIR/td/1257.txt"
cat >"$CASE_DIR/td/1257.fail" <<'ERR'
An error occurred (ThrottlingException) when calling the DescribeTaskDefinition operation: Rate exceeded
ERR
cat >"$CASE_DIR/service.json" <<JSON
{"td":"$arn:1257",
 "desired":10,"running":10,"pending":0,
 "deployments":[{"id":"ecs-svc/9304510563921584425","td":"$arn:1257","status":"PRIMARY","rollout":"COMPLETED","desired":10,"running":10,"pending":0,"created":"2026-11-10T01:23:51.407000+00:00"}],
 "events":[]}
JSON
check "unreadable task definition does not fail the job" 0 \
  "::warning::Could not read the image tag" \
  "unreadable ECS" \
  "ThrottlingException"
check_absent "unreadable task definition is not a mismatch" \
  "no deployment for that revision"

# Same failure, but on a deployment that is NOT the PRIMARY: the verdict still
# cannot be made, because "no deployment references the revision" would be a guess.
case_dir tag-unreadable-secondary "$sha"
printf '%s:%s' "$img" "$sha" >"$CASE_DIR/td/1257.txt"
printf '%s:d4c3b2a1f0e9d8c7b6a594837261504938271605' "$img" >"$CASE_DIR/td/1249.txt"
cat >"$CASE_DIR/td/1249.fail" <<'ERR'
An error occurred (AccessDeniedException) when calling the DescribeTaskDefinition operation: not authorized
ERR
cat >"$CASE_DIR/service.json" <<JSON
{"td":"$arn:1257",
 "desired":10,"running":10,"pending":0,
 "deployments":[{"id":"ecs-svc/9304510563921584425","td":"$arn:1257","status":"ACTIVE","rollout":"COMPLETED","desired":0,"running":0,"pending":0,"created":"2026-11-10T01:23:51.407000+00:00"},
   {"id":"ecs-svc/1111111111111111111","td":"$arn:1249","status":"PRIMARY","rollout":"IN_PROGRESS","desired":10,"running":10,"pending":0,"created":"2026-11-10T02:23:51.407000+00:00"}],
 "events":[]}
JSON
check "unreadable secondary task definition does not fail the job" 0 \
  "::warning::Could not read the image tag" \
  "AccessDeniedException"
check_absent "unreadable secondary task definition is not a mismatch" \
  "no deployment for that revision"

echo
if [ "$failures" -ne 0 ]; then
  echo "::error::$failures verify-deployed self-test failure(s)"
  exit 1
fi
echo "verify-deployed self-test passed"
