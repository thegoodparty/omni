#!/usr/bin/env bash
# Decide whether a failed release run lost a runner, and if so re-run its
# failed jobs. Called by .github/workflows/release-retry.yml (ENG-11537).
#
# Retries only when ALL of these hold:
#   - the attempt that failed is attempt 1 or 2 (at most 2 retries);
#   - every failed job carries GitHub's lost-runner annotation, so a real
#     failure (a red E2E, a failed deploy) is never retried;
#   - every failed job is either on the STATELESS list below, or recorded no
#     steps at all (its runner died before checkout, so nothing ran). A job
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
      echo "| Failed job | Started | Ended | Duration | Steps | Verdict |"
      echo "|---|---|---|---|---|---|"
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

# id, steps recorded, started, ended, duration in seconds, name
failed=$(gh api --paginate "repos/$REPO/actions/runs/$RUN_ID/attempts/$ATTEMPT/jobs?per_page=100" \
  --jq '.jobs[] | select(.conclusion == "failure")
    | [.id, (.steps | length), (.started_at // "-"), (.completed_at // "-"),
       (if .started_at and .completed_at
        then ((.completed_at | fromdate) - (.started_at | fromdate)) else -1 end),
       .name] | @tsv')
[ -n "$failed" ] || skip "no failed jobs in this attempt"

# Judge every failed job, not just the first, so the summary names them all.
blocker=""
while IFS=$'\t' read -r id steps started ended secs name; do
  if ! gh api "repos/$REPO/check-runs/$id/annotations" --jq '.[].message' | grep -qF "$LOST"; then
    verdict="failed for a reason other than a lost runner"
  elif [ "$steps" -gt 0 ] && ! grep -qE "$STATELESS_RE" <<<"$name"; then
    verdict="lost its runner mid-run and holds deploy state; check its lock and re-run by hand"
  else
    verdict=""
  fi
  if [ "$secs" -ge 0 ]; then dur="$((secs / 60))m $((secs % 60))s"; else dur="-"; fi
  rows+="| $name | $started | $ended | $dur | $steps | ${verdict:-lost its runner; safe to retry} |\n"
  echo "'$name': steps=$steps duration=$dur verdict=${verdict:-retryable}"
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
