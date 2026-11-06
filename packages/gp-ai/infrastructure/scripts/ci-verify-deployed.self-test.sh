#!/usr/bin/env bash
# Fixture test for ci-verify-deployed.sh (ENG-11607).
#
# The script's whole job is to say what prod is running. On 2026-11-06 it said
# the opposite of the truth: ECS in us-west-2 was answering 503 Service
# Unavailable for the whole prod verify, every read failed, and the failures
# surfaced as six assertions about prod — "no ACTIVE task definition", "could
# not read PRIMARY deployment", "latest revision is ," — while all six gp-ai
# components were on the promoted commit. A false regression report is worse
# than a red job, because it sends a person to look in the wrong place.
#
# So the assertions here are mostly negative: an ECS that will not answer must
# never produce a FAIL line about a component, and must never produce a pass.
# Each case stubs `aws` on PATH; none of them touches real AWS.
#
# Runs in gp-ai.yml's TF plan job, before the credentials step, the same way
# ci-check-root-coverage.sh does: static, no AWS, about a second.
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
script="$here/ci-verify-deployed.sh"
sha="deadbeef"
failures=0

stub_dir="$(mktemp -d)"
trap 'rm -rf "$stub_dir"' EXIT

# One stub `aws` for every case. $STUB picks the behaviour; it is read from the
# environment so each invocation can differ.
cat >"$stub_dir/aws" <<'STUB'
#!/usr/bin/env bash
set -uo pipefail
# argv: aws ecs <subcommand> ...
sub="$2"
unavailable() {
  echo "An error occurred (503) when calling the ${1} operation (reached max retries: 2): Service Unavailable" >&2
  exit 255
}
# The ARN the script asked about, from `--task-definition <arn>`.
td=""
prev=""
for a in "$@"; do [ "$prev" = "--task-definition" ] && td="$a"; prev="$a"; done
family="${td##*/}"
family="${family%%:*}"
case "${STUB}:${sub}" in
  down:*)
    unavailable "$sub"
    ;;
  down_list:list-task-definitions)
    unavailable "$sub"
    ;;
  down_describe:describe-task-definition)
    unavailable "$sub"
    ;;
  down_services:describe-services)
    unavailable "$sub"
    ;;
esac
case "$sub" in
  describe-services)
    # Shape: the script's --query already picked [0], so it expects one object.
    echo '{"td":"arn:aws:ecs:us-west-2:333022194791:task-definition/broker-prod:962","state":"COMPLETED","desired":5,"running":5,"pending":0}'
    ;;
  list-task-definitions)
    # A genuine answer with nothing in it: the family has no ACTIVE revision.
    if [ "${STUB}" = "empty_family" ] && [[ "$*" == *pmf-engine* ]]; then
      echo "None"
    else
      echo "arn:aws:ecs:us-west-2:333022194791:task-definition/$(sed -n 's/.*--family-prefix \([^ ]*\).*/\1/p' <<<"$*"):1"
    fi
    ;;
  describe-task-definition)
    if [ "${STUB}" = "wrong_tag" ]; then
      echo "333022194791.dkr.ecr.us-west-2.amazonaws.com/gp-ai-projects:stale"
    else
      # The promoted tag for that family: <service>-<sha>, prod suffix dropped.
      echo "333022194791.dkr.ecr.us-west-2.amazonaws.com/gp-ai-projects:${family%-prod}-${SHA_UNDER_TEST}"
    fi
    ;;
  *)
    exit 0
    ;;
esac
STUB
chmod +x "$stub_dir/aws"

# Runs the script against the stub and leaves output in $out, exit code in $rc.
run() {
  local stub="$1"
  out=$(PATH="$stub_dir:$PATH" STUB="$stub" SHA_UNDER_TEST="$sha" \
    ROLLOUT_WAIT_SECONDS=0 ECS_BACKOFF_SECONDS=0 \
    bash "$script" prod "$sha" 2>&1)
  rc=$?
}

report() {
  local label="$1" want_rc="$2"
  shift 2
  local problem=""
  if [ "$rc" != "$want_rc" ]; then problem="exit $rc, want $want_rc"; fi
  # Each remaining argument is "present:<text>" or "absent:<text>".
  local expectation verb text
  for expectation in "$@"; do
    verb="${expectation%%:*}"
    text="${expectation#*:}"
    case "$verb" in
      present) [[ "$out" == *"$text"* ]] || problem="${problem:+$problem; }missing: $text" ;;
      absent) [[ "$out" != *"$text"* ]] || problem="${problem:+$problem; }should not appear: $text" ;;
    esac
  done
  if [ -z "$problem" ]; then
    echo "ok    $label"
  else
    echo "FAIL  $label — $problem"
    echo "$out" | sed 's/^/        /'
    failures=$((failures + 1))
  fi
}

# --- healthy: everything on the SHA -----------------------------------------
run healthy
report 'all components on the SHA pass' 0 \
  'present:ok    broker-prod' \
  'present:ok    pmf-engine-prod' \
  'present:ok    autopilot-agent-playwright-prod' \
  'present:all gp-ai components in prod are running' \
  'absent:FAIL' \
  'absent:UNVERIFIED'

# --- the 2026-11-06 shape: ECS refuses every call ----------------------------
# The regression this file exists for. Not one of these strings may appear.
run down
report 'ECS down is UNVERIFIED, never a claim about prod' 1 \
  'absent:no ACTIVE task definition' \
  'absent:could not read PRIMARY deployment' \
  'absent:latest revision is ,' \
  'absent:are not running' \
  'present:UNVERIFIED  broker-prod' \
  'present:UNVERIFIED  pmf-engine-prod' \
  'present:could not be read from ECS' \
  'present:prod is unverified'

# --- partial outages: the exact three shapes the incident printed ------------
# Each of these used to be indistinguishable from a real finding.
run down_services
report 'describe-services 503 is not "could not read PRIMARY deployment"' 1 \
  'absent:could not read PRIMARY deployment' \
  'absent:FAIL' \
  'present:UNVERIFIED  broker-prod' \
  'present:503'

run down_list
report 'list-task-definitions 503 is not "no ACTIVE task definition"' 1 \
  'absent:no ACTIVE task definition' \
  'present:UNVERIFIED  pmf-engine-prod' \
  'present:503'

run down_describe
report 'describe-task-definition 503 is not "latest revision is ,"' 1 \
  'absent:latest revision is ,' \
  'present:UNVERIFIED  pmf-engine-prod' \
  'present:503'

# --- real findings still fail, and still say what is wrong -------------------
run empty_family
report 'an EMPTY ACTIVE list is still a real FAIL' 1 \
  'present:FAIL  pmf-engine-prod' \
  'present:no ACTIVE task definition' \
  'absent:UNVERIFIED  pmf-engine-prod'

run wrong_tag
report 'the wrong image tag is still a real FAIL' 1 \
  'present:expected tag pmf-engine-deadbeef' \
  'absent:UNVERIFIED'

# --- a transient failure that clears on retry passes -------------------------
# Without the retry a single 503 would still cost the release a red stage.
cat >"$stub_dir/aws" <<'STUB'
#!/usr/bin/env bash
set -uo pipefail
counter="$STUB_DIR/$(echo "$*" | md5sum | cut -d' ' -f1)"
n=$(( $(cat "$counter" 2>/dev/null || echo 0) + 1 ))
echo "$n" >"$counter"
if [ "$n" -eq 1 ]; then
  echo "An error occurred (503) when calling the ${2} operation: Service Unavailable" >&2
  exit 255
fi
case "$2" in
  describe-services)
    echo '{"td":"arn:aws:ecs:us-west-2:333022194791:task-definition/broker-prod:962","state":"COMPLETED","desired":5,"running":5,"pending":0}' ;;
  list-task-definitions)
    echo "arn:aws:ecs:us-west-2:333022194791:task-definition/$(sed -n 's/.*--family-prefix \([^ ]*\).*/\1/p' <<<"$*"):1" ;;
  describe-task-definition)
    td=""
    prev=""
    for a in "$@"; do [ "$prev" = "--task-definition" ] && td="$a"; prev="$a"; done
    fam="${td##*/}"
    fam="${fam%%:*}"
    echo "333022194791.dkr.ecr.us-west-2.amazonaws.com/gp-ai-projects:${fam%-prod}-${SHA_UNDER_TEST}" ;;
esac
STUB
chmod +x "$stub_dir/aws"
out=$(PATH="$stub_dir:$PATH" STUB_DIR="$stub_dir" SHA_UNDER_TEST="$sha" \
  ROLLOUT_WAIT_SECONDS=0 ECS_BACKOFF_SECONDS=0 bash "$script" prod "$sha" 2>&1)
rc=$?
report 'a 503 that clears on retry passes' 0 \
  'present:all gp-ai components in prod are running' \
  'absent:UNVERIFIED' \
  'absent:FAIL'

echo
if [ "$failures" -ne 0 ]; then
  echo "$failures fixture case(s) failed"
  exit 1
fi
echo "ci-verify-deployed.sh: all fixture cases passed"
