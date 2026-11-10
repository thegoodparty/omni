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
# describe-services: the script asks for --output json, so serve raw JSON.
# describe-task-definition: it asks for a --query with --output text, so serve
# the image URI, which is what the real CLI would print.
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
    cat "$FAKE_DIR/td/${td##*:}.txt"
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

case_dir() {
  CASE_DIR="$tmp/$1"
  CASE_SHA="$2"
  mkdir -p "$CASE_DIR/td"
  export FAKE_DIR="$CASE_DIR"
}

sha=1bd63c3eb665061073287bee2f5fa5040e827d5c
img="333022194791.dkr.ecr.us-west-2.amazonaws.com/gp-api"

# A healthy promote: Pulumi's wait returned, ECS runs the promoted revision.
case_dir serving "$sha"
printf '%s:%s' "$img" "$sha" >"$CASE_DIR/td/1257.txt"
cat >"$CASE_DIR/service.json" <<JSON
{"td":"arn:aws:ecs:us-west-2:333022194791:task-definition/gp-master-fargateCluster-gp-api-master:1257",
 "desired":10,"running":10,"pending":0,
 "deployments":[{"id":"ecs-svc/9304510563921584425","td":"arn:aws:ecs:us-west-2:333022194791:task-definition/gp-master-fargateCluster-gp-api-master:1257","status":"PRIMARY","rollout":"COMPLETED","desired":10,"running":10,"pending":0,"created":"2026-11-10T01:23:51.407000+00:00"}],
 "events":[{"at":"2026-11-10T01:24:00.000000+00:00","msg":"(service svc) has started 10 tasks."}]}
JSON
check "promoted revision is serving" 0 "is serving $sha"

# ENG-11609 itself: Pulumi's wait timed out and left the service configured with
# the new revision, but ECS never scheduled a task for it. The last service
# event predates the deployment, as it did live.
case_dir never-started "$sha"
printf '%s:4a3e6ba0b328499921b718178f710159ac261c0e' "$img" >"$CASE_DIR/td/1239.txt"
printf '%s:%s' "$img" "$sha" >"$CASE_DIR/td/1240.txt"
cat >"$CASE_DIR/service.json" <<JSON
{"td":"arn:aws:ecs:us-west-2:333022194791:task-definition/gp-master-fargateCluster-gp-api-master:1240",
 "desired":10,"running":10,"pending":0,
 "deployments":[
   {"id":"ecs-svc/0261404581972104932","td":"arn:aws:ecs:us-west-2:333022194791:task-definition/gp-master-fargateCluster-gp-api-master:1240","status":"PRIMARY","rollout":"IN_PROGRESS","desired":10,"running":0,"pending":0,"created":"2026-11-06T22:45:58.533000+00:00"},
   {"id":"ecs-svc/2643059575875231771","td":"arn:aws:ecs:us-west-2:333022194791:task-definition/gp-master-fargateCluster-gp-api-master:1239","status":"ACTIVE","rollout":"COMPLETED","desired":10,"running":10,"pending":0,"created":"2026-11-06T22:21:56.000000+00:00"}],
 "events":[{"at":"2026-11-06T22:43:37.000000+00:00","msg":"(service svc) has reached a steady state."}]}
JSON
check "rollout that never started a task" 1 \
  "never scheduled a task" \
  "That is a control-plane stall" \
  "nothing left to change" \
  "::error::"

# Same wait timeout, but tasks did start and stop: that is the commit's problem.
case_dir started-then-failed "$sha"
printf '%s:%s' "$img" "$sha" >"$CASE_DIR/td/1240.txt"
cat >"$CASE_DIR/service.json" <<JSON
{"td":"arn:aws:ecs:us-west-2:333022194791:task-definition/gp-master-fargateCluster-gp-api-master:1240",
 "desired":10,"running":0,"pending":0,
 "deployments":[{"id":"ecs-svc/0261404581972104932","td":"arn:aws:ecs:us-west-2:333022194791:task-definition/gp-master-fargateCluster-gp-api-master:1240","status":"PRIMARY","rollout":"FAILED","desired":10,"running":0,"pending":0,"created":"2026-11-06T22:45:58.533000+00:00"}],
 "events":[{"at":"2026-11-06T22:47:00.000000+00:00","msg":"(service svc) has started 10 tasks."},{"at":"2026-11-06T22:49:00.000000+00:00","msg":"(service svc) has stopped 10 running tasks."}]}
JSON
check "rollout that started tasks and failed" 1 \
  "did not become" \
  "Read their CloudWatch logs"

# The update never reached ECS, so no deployment references the revision.
case_dir never-updated "$sha"
printf '%s:831b5f08556059dc201d98063d26b50c403b4577' "$img" >"$CASE_DIR/td/1257.txt"
cat >"$CASE_DIR/service.json" <<JSON
{"td":"arn:aws:ecs:us-west-2:333022194791:task-definition/gp-master-fargateCluster-gp-api-master:1257",
 "desired":10,"running":10,"pending":0,
 "deployments":[{"id":"ecs-svc/9304510563921584425","td":"arn:aws:ecs:us-west-2:333022194791:task-definition/gp-master-fargateCluster-gp-api-master:1257","status":"PRIMARY","rollout":"COMPLETED","desired":10,"running":10,"pending":0,"created":"2026-11-10T01:23:51.407000+00:00"}],
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

echo
if [ "$failures" -ne 0 ]; then
  echo "::error::$failures verify-deployed self-test failure(s)"
  exit 1
fi
echo "verify-deployed self-test passed"
