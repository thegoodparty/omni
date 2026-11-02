#!/usr/bin/env bash
# Decide whether a failed or cancelled release run lost a runner, and if so
# re-run its failed jobs (GitHub's re-run includes cancelled ones). Called by .github/workflows/release-retry.yml (ENG-11537).
#
# Retries only when ALL of these hold:
#   - the attempt that failed is attempt 1 or 2 (at most 2 retries);
#   - every failed or cancelled job lost its runner, so a real failure (a red
#     E2E, a failed deploy) or a manual cancel is never retried. That means
#     either GitHub's lost-runner annotation, or a hit timeout-minutes with
#     no step past "Set up job": a dead runner cut off by the job timeout
#     gets the timeout's annotation instead, and nothing ran. A timeout after
#     steps ran is a slow or hung job, and is never retried. A timed-out job
#     concludes `cancelled`, and so does its run, not `failure`;
#   - every such job is either on the STATELESS list below, or ran no step
#     past "Set up job" (its runner died before checkout). A job
#     that runs a Pulumi or Terraform apply is never retried mid-run: a dead
#     runner can leave a state lock and a half-applied stack, and
#     docs/deployment.md rules out retrying an apply on top of that;
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
# release.yml jobs that hold no deploy state, so a re-run is always safe.
# Not here on purpose: Dev/Promote gp-api (Pulumi), Dev/Promote gp-ai
# (Terraform). A job added to release.yml is not retried until it is added.
STATELESS_RE='^(Await checks|Dev gp-webapp|Dev candidate-sites|Verify dev serving|E2E Shard \([0-9]+\)|E2E|Promote gp-webapp|Promote gp-admin|Promote candidate-sites|Promote experiment manifests|Check gp-ai images|Record prod deployment)$'

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

# id, conclusion, steps that ran (excluding GitHub's own "Set up job" and
# "Complete job"), started, ended, duration in seconds, name
failed=$(gh api --paginate "repos/$REPO/actions/runs/$RUN_ID/attempts/$ATTEMPT/jobs?per_page=100" \
  --jq '.jobs[] | select(.conclusion == "failure" or .conclusion == "cancelled")
    | [.id, .conclusion,
       ([.steps[] | select(.name != "Set up job" and .name != "Complete job")] | length),
       (.started_at // "-"), (.completed_at // "-"),
       (if .started_at and .completed_at
        then ((.completed_at | fromdate) - (.started_at | fromdate)) else -1 end),
       .name] | @tsv')
[ -n "$failed" ] || skip "no failed or cancelled jobs in this attempt"

# Judge every failed job, not just the first, so the summary names them all.
blocker=""
while IFS=$'\t' read -r id conclusion steps started ended secs name; do
  # Captured first, not piped into grep -q, so an early grep exit cannot
  # SIGPIPE the gh call under pipefail.
  notes=$(gh api "repos/$REPO/check-runs/$id/annotations" --jq '.[].message')
  if grep -qF "$LOST" <<<"$notes"; then
    cause="lost runner"
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
  elif [ "$steps" -gt 0 ] && ! grep -qE "$STATELESS_RE" <<<"$name"; then
    verdict="lost its runner mid-run and holds deploy state; check its lock and re-run by hand"
  else
    verdict=""
  fi
  if [ "$secs" -ge 0 ]; then dur="$((secs / 60))m $((secs % 60))s"; else dur="-"; fi
  rows+="| $name | $conclusion | $started | $ended | $dur | $steps | ${verdict:-$cause; safe to retry} |\n"
  echo "'$name': $conclusion steps_run=$steps duration=$dur verdict=${verdict:-retryable}"
  [ -n "$blocker" ] || [ -z "$verdict" ] || blocker="'$name' $verdict"
done <<<"$failed"
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
echo "::warning::Re-ran failed jobs of release run $RUN_ID (lost runner, retry $ATTEMPT of $MAX_ATTEMPT)"
