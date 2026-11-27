#!/usr/bin/env bash
# Decide whether a failed or cancelled release run lost a runner, and if so
# re-run its failed jobs and the jobs that depend on them (GitHub's re-run
# includes cancelled ones). Called by .github/workflows/release-retry.yml (ENG-11537).
#
# Retries only when ALL of these hold:
#   - the attempt that failed is attempt 1 or 2 (at most 2 retries);
#   - every failed or cancelled job lost its runner, so a real failure (a red
#     E2E, a failed deploy) or a manual cancel is never retried. That means
#     either GitHub's lost-runner annotation, or a hit timeout-minutes with
#     no step past "Set up job": a dead runner cut off by the job timeout
#     gets the timeout's annotation instead, and nothing ran. A timeout after
#     steps ran is a slow or hung job, and is never retried. A timed-out job
#     concludes `cancelled`, and so does its run, not `failure`. Also GitHub's
#     "Unable to fetch the information for the environment" with no step run
#     (ENG-11600): GitHub failed before the job started, so nothing ran;
#   - the `E2E` gate job, which an always() step turns red whenever a shard
#     is, does not block on its own: it is judged by the jobs behind it, which
#     are in the same list (ENG-11537 review). A red gate with no other red job
#     in the attempt is not understood, so nothing is retried then;
#   - every such job either ran no step past "Set up job" (its runner died
#     before checkout), or started no step that mutates deploy state. A job
#     that runs a Pulumi or Terraform apply is never retried once that step
#     started: a dead runner can leave a state lock and a half-applied stack,
#     and docs/deployment.md rules out retrying an apply on top of that. The
#     question is asked of the steps that started, not of the job, because a
#     deploy job also holds minutes of idempotent work before its apply
#     (ENG-11700);
#   - no newer release run exists. Re-running an old run after a newer one
#     would promote an older SHA over it, and a queued re-run could supersede
#     the newer run waiting in the release-train concurrency group. The newer
#     run ships everything this one would have.
#
# Env: REPO, RUN_ID, ATTEMPT, GH_TOKEN. DRY_RUN=1 prints the decision only.
# Writes a summary (run, each failed job's timing and verdict, the decision)
# to $GITHUB_STEP_SUMMARY, or to stdout when that is unset.
set -euo pipefail

MAX_ATTEMPT=2
LOST='The hosted runner lost communication with the server'
TIMEOUT='has exceeded the maximum execution time'
ENVFETCH="Unable to fetch the information for the environment"
# release.yml jobs that hold no deploy state, so a re-run is always safe.
# Every other job is judged by STATEFUL_STEP_RE below instead: it is retried
# unless one of those steps started. Not here on purpose: Dev/Promote gp-api
# (Pulumi) and Dev/Promote gp-ai (Terraform), whose builds are safe to repeat
# and whose applies are not.
STATELESS_RE='^(Await checks|Dev gp-webapp|Dev candidate-sites|Verify dev serving|E2E Shard \([0-9]+\)|E2E|Promote gp-webapp|Promote gp-admin|Promote candidate-sites|Promote experiment manifests|Check gp-ai images|Record prod deployment)$'
# Steps that mutate remote deploy state once started, so a job that ran one and
# lost its runner is not retried: a dead runner can leave a state lock and a
# half-applied stack. Name a new apply step to match one of these, or a lost
# runner after it started will be retried mid-apply.
STATEFUL_STEP_RE='^(Deploy \(Pulumi\)|apply |reverify )'

SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/stdout}"
RUN_URL="https://github.com/$REPO/actions/runs/$RUN_ID/attempts/$ATTEMPT"
rows=""
decision="errored before deciding; see the log"

# Always write the summary, including when a gh call fails under set -e.
write_summary() {
  {
    echo "### Release retry: [run $RUN_ID, attempt $ATTEMPT]($RUN_URL)"
    echo
    echo "**Decision:** $decision"
    if [ -n "$rows" ]; then
      echo
      echo "| Job | Conclusion | Started | Ended | Duration | Steps run | Verdict |"
      echo "|---|---|---|---|---|---|---|"
      printf '%b' "$rows"
    fi
  } >>"$SUMMARY"
}
trap write_summary EXIT

skip() {
  decision="no retry: $*"
  echo "::notice::No retry for run $RUN_ID attempt $ATTEMPT: $*"
  exit 0
}

[ "$ATTEMPT" -le "$MAX_ATTEMPT" ] || skip "already retried $((ATTEMPT - 1)) times"

# id, conclusion, steps that started (excluding GitHub's own "Set up job" and
# "Complete job"), started, ended, duration in seconds, name, the names of the
# steps that started
failed=$(gh api --paginate "repos/$REPO/actions/runs/$RUN_ID/attempts/$ATTEMPT/jobs?per_page=100" \
  --jq '.jobs[] | select(.conclusion == "failure" or .conclusion == "cancelled")
    | ([.steps[] | select(.name != "Set up job" and .name != "Complete job"
        and .started_at != null)]) as $ran
    | [.id, .conclusion, ($ran | length),
       (.started_at // "-"), (.completed_at // "-"),
       (if .started_at and .completed_at
        then ((.completed_at | fromdate) - (.started_at | fromdate)) else -1 end),
       .name, ([$ran[].name] | join(", "))] | @tsv')
[ -n "$failed" ] || skip "no failed or cancelled jobs in this attempt"

# Judge every failed job, not just the first, so the summary names them all.
blocker=""
saw_gate=0
saw_shard=0
saw_other=0
while IFS=$'\t' read -r id conclusion steps started ended secs name ran_steps; do
  # Captured first, not piped into grep -q, so an early grep exit cannot
  # SIGPIPE the gh call under pipefail.
  notes=$(gh api "repos/$REPO/check-runs/$id/annotations" --jq '.[].message')
  # Failure-level annotations other than the E2E gate's own two lines.
  other=$(gh api "repos/$REPO/check-runs/$id/annotations" \
    --jq '.[] | select(.annotation_level == "failure") | .message' |
    grep -vE '^(E2E shards result: .*|Process completed with exit code 1\.)$' || true)
  case "$name" in
  "E2E Shard "*) saw_shard=1 ;;
  E2E) ;;
  *) saw_other=1 ;;
  esac
  if grep -qF "$LOST" <<<"$notes"; then
    cause="lost runner"
  elif [ "$steps" -eq 0 ] && grep -qF "$ENVFETCH" <<<"$notes"; then
    cause="environment lookup failed before any step ran"
  elif [ "$name" = E2E ] && [ -z "$other" ]; then
    # The always() gate goes red whenever a job it needs did not succeed. It is
    # judged by that job, which is in this same list.
    cause="E2E gate, red because a job it needs did not succeed; judged by that job"
    saw_gate=1
  elif [ "$steps" -eq 0 ] && grep -qF "$TIMEOUT" <<<"$notes"; then
    cause="timed out before any step ran"
  else
    cause=""
  fi
  if [ -z "$cause" ] && grep -qF "$TIMEOUT" <<<"$notes"; then
    verdict="timed out after steps ran, so a slow or hung job, not a dead runner"
  elif [ -z "$cause" ] && [ "$conclusion" = cancelled ]; then
    verdict="cancelled, not by a dead runner"
  elif [ -z "$cause" ]; then
    verdict="failed for a reason other than a lost runner"
  elif [ "$steps" -gt 0 ] && ! grep -qE "$STATELESS_RE" <<<"$name" \
    && grep -qE "$STATEFUL_STEP_RE" <<<"${ran_steps//, /$'\n'}"; then
    verdict="lost its runner after a deploy-state step started; check its lock and re-run by hand"
  else
    verdict=""
  fi
  if [ "$secs" -ge 0 ]; then dur="$((secs / 60))m $((secs % 60))s"; else dur="-"; fi
  if [ -n "$verdict" ]; then shown="$verdict"
  elif [ "$name" = E2E ] && [ "$saw_gate" = 1 ]; then shown="$cause"
  else shown="$cause; safe to retry"; fi
  rows+="| $name | $conclusion | $started | $ended | $dur | $steps | $shown |\n"
  echo "'$name': $conclusion steps_run=$steps duration=$dur verdict=${verdict:-retryable}"
  [ -n "$blocker" ] || [ -z "$verdict" ] || blocker="'$name' $verdict"
done <<<"$failed"
# A red gate with no failed shard is understood only when another job in this
# attempt is red too: the gate needs it, and GitHub re-runs a failed job's
# dependent jobs with it, so the shards the gate reads come back on their own.
# Alone, a red gate is not understood, so nothing is retried.
if [ -z "$blocker" ] && [ "$saw_gate" = 1 ] && [ "$saw_shard" = 0 ] && [ "$saw_other" = 0 ]; then
  blocker="'E2E' gate is red but no shard failed in this attempt"
fi
[ -z "$blocker" ] || skip "$blocker"

run_number=$(gh api "repos/$REPO/actions/runs/$RUN_ID" --jq .run_number)
newer=$(gh api "repos/$REPO/actions/workflows/release.yml/runs?per_page=20" \
  --jq "[.workflow_runs[] | select(.run_number > $run_number) | .id]
    | if length > 0 then \"\(length) newer, latest \(.[0])\" else \"\" end")
[ -z "$newer" ] || skip "newer release run(s) exist ($newer); they will ship this commit's changes"

if [ "${DRY_RUN:-0}" = 1 ]; then
  decision="DRY_RUN: would re-run the failed jobs (retry $ATTEMPT of $MAX_ATTEMPT)"
  echo "$decision"
  exit 0
fi
gh api -X POST "repos/$REPO/actions/runs/$RUN_ID/rerun-failed-jobs" >/dev/null
decision="re-ran the failed jobs (retry $ATTEMPT of $MAX_ATTEMPT)"
echo "::warning::Re-ran failed jobs of release run $RUN_ID (GitHub infra failure, retry $ATTEMPT of $MAX_ATTEMPT)"
