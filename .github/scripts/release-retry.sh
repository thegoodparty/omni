#!/usr/bin/env bash
# Decide whether a release run failed only because GitHub lost a runner or never
# started a job, and if so re-run those jobs. Called by
# .github/workflows/release-retry.yml (ENG-11537, ENG-11624). The cases are
# exercised by .github/scripts/release-retry.self-test.sh.
#
# SELECTION IS BY THE JOB'S OWN STATE, NOT BY GITHUB'S VERDICT. Every job in the
# attempt that is neither `success` nor `skipped` is judged, including a job
# GitHub left with no conclusion at all. During the Actions outage of
# 2026-11-11 GitHub closed run 43090680255 as failed while "Record prod
# deployment" was still `queued` with conclusion null, no step, and no log; a
# selector keyed on `conclusion == failure|cancelled` never saw the one job that
# lost the run its deployment record, so nothing was retried (ENG-11624).
#
# For each judged job:
#   - never started, and the run concluded `failure`: still queued with no step
#     run means GitHub never allocated a runner, so it is retryable whatever it
#     did or did not annotate. Its outcome is a fact about the job: nothing ran,
#     so a re-run cannot repeat a code failure. It is re-run by id, because
#     "re-run failed jobs" only re-runs jobs GitHub concluded as failed;
#   - started, then died: only GitHub's own annotations can say it was not the
#     code's fault. Either GitHub's lost-runner annotation, or a hit
#     timeout-minutes with no step past "Set up job" (a dead runner cut off by
#     the timeout gets the timeout's annotation instead, and nothing ran; a
#     timeout after steps ran is a slow or hung job and is never retried), or
#     GitHub's "Unable to fetch the information for the environment" with no
#     step run (ENG-11600);
#   - anything else is a real failure and is never retried. That includes a job
#     left `waiting` or running when the run concluded: its outcome is unknown,
#     so a person looks at it.
#
# It also does not retry when:
#   - the attempt that failed is not attempt 1 or 2 (at most 2 retries);
#   - the `E2E` gate job, which an always() step turns red whenever a shard is,
#     blocks: it is judged by the shards, in the same list (ENG-11537 review);
#   - a started job that lost its runner is not on the STATELESS list below: a
#     Pulumi or Terraform apply is never retried mid-run, because a dead runner
#     can leave a state lock and a half-applied stack, and docs/deployment.md
#     rules that out;
#   - a newer release run exists. Re-running an old run after a newer one would
#     promote an older SHA over it, and a queued re-run could supersede the newer
#     run waiting in the release-train concurrency group.
#
# Env: REPO, RUN_ID, ATTEMPT, GH_TOKEN. DRY_RUN=1 prints the decision only.
# CLASSIFY_ONLY=1 skips every API call, reads job records (the jobs API's own
# JSON, plus an `annotations` array) one per line on stdin, and prints the
# decision — that is what the fixture test drives. RUN_CONCLUSION overrides the
# run's conclusion in that mode.
# Writes a summary (run, each job's timing and verdict, the decision) to
# $GITHUB_STEP_SUMMARY, or to stdout when that is unset.
set -euo pipefail

MAX_ATTEMPT=2
LOST='The hosted runner lost communication with the server'
TIMEOUT='has exceeded the maximum execution time'
ENVFETCH="Unable to fetch the information for the environment"
# release.yml jobs that hold no deploy state, so a re-run is always safe.
# Not here on purpose: Dev/Promote gp-api (Pulumi), Dev/Promote gp-ai
# (Terraform). A job added to release.yml is not retried until it is added.
STATELESS_RE='^(Await checks|Dev gp-webapp|Dev candidate-sites|Verify dev serving|E2E Shard \([0-9]+\)|E2E|Promote gp-webapp|Promote gp-admin|Promote candidate-sites|Promote experiment manifests|Check gp-ai images|Record prod deployment)$'

SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/stdout}"
RUN_URL="https://github.com/$REPO/actions/runs/$RUN_ID/attempts/$ATTEMPT"
rows=""
decision="errored before deciding; see the log"
# Set by classify: why nothing may be retried, and what may be.
blocker=""
# "id" of each job GitHub concluded as failed or cancelled, and of each job it
# closed the run without concluding.
concluded=""
never_started=""
run_conclusion="${RUN_CONCLUSION:-}"

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

# Judge every job record on stdin and set blocker, the two id lists and the
# summary rows. Reads no API, so the fixture test can drive it directly.
classify() {
  local rec id name status conclusion steps started ended secs notes other cause verdict shown dur
  local saw_gate=0 saw_shard=0
  while IFS= read -r rec; do
    [ -n "$rec" ] || continue
    # The steps that ran, excluding GitHub's own "Set up job" and
    # "Complete job": a job whose runner died before checkout shows 0 here.
    IFS=$'\t' read -r id name status conclusion steps started ended secs \
      <<<"$(jq -r '[.id, .name, (.status // "-"), (.conclusion // "-"),
        ([.steps[]? | select(.name != "Set up job" and .name != "Complete job")] | length),
        (.started_at // "-"), (.completed_at // "-"),
        (if .started_at and .completed_at
         then ((.completed_at | fromdate) - (.started_at | fromdate)) else -1 end)]
        | @tsv' <<<"$rec")"
    # Both captured before the grep, not piped in, so an early grep exit cannot
    # SIGPIPE jq under pipefail.
    notes=$(jq -r '.annotations[]? | .message' <<<"$rec")
    # Failure-level annotations other than the E2E gate's own two lines.
    other=$(jq -r '.annotations[]? | select(.level == "failure") | .message' <<<"$rec" |
      grep -vE '^(E2E shards result: .*|Process completed with exit code 1\.)$' || true)
    case "$name" in "E2E Shard "*) saw_shard=1 ;; esac
    cause=""
    verdict=""
    if [ "$conclusion" = "-" ]; then
      # GitHub never wrote an outcome. Ask what the job itself did instead.
      if [ "$status" = queued ] && [ "$steps" -eq 0 ] && [ "${run_conclusion:-failure}" = failure ]; then
        cause="never started: still queued when the run concluded"
      elif [ "$status" = queued ] && [ "$steps" -eq 0 ]; then
        verdict="left queued when a run that did not fail concluded, so not a lost runner"
      else
        verdict="left '$status' with no conclusion; its outcome is unknown"
      fi
    elif grep -qF "$LOST" <<<"$notes"; then
      cause="lost runner"
    elif [ "$steps" -eq 0 ] && grep -qF "$ENVFETCH" <<<"$notes"; then
      cause="environment lookup failed before any step ran"
    elif [ "$name" = E2E ] && [ -z "$other" ]; then
      # The always() gate goes red whenever a shard does. It is judged by its
      # shards: they are in this same list, and any real shard failure blocks.
      cause="E2E gate, red only because a shard was; judged by the shards"
      saw_gate=1
    elif [ "$steps" -eq 0 ] && grep -qF "$TIMEOUT" <<<"$notes"; then
      cause="timed out before any step ran"
    else
      cause=""
    fi
    if [ -z "$verdict" ]; then
      if [ -z "$cause" ] && grep -qF "$TIMEOUT" <<<"$notes"; then
        verdict="timed out after steps ran, so a slow or hung job, not a dead runner"
      elif [ -z "$cause" ] && [ "$conclusion" = cancelled ]; then
        verdict="cancelled, not by a dead runner"
      elif [ -z "$cause" ]; then
        verdict="failed for a reason other than a lost runner"
      elif [ "$steps" -gt 0 ] && ! grep -qE "$STATELESS_RE" <<<"$name"; then
        verdict="lost its runner mid-run and holds deploy state; check its lock and re-run by hand"
      fi
    fi
    # Both lists hold only jobs that may be re-run: what for, and how.
    if [ -z "$verdict" ]; then
      if [ "$conclusion" = "-" ]; then
        never_started+="${never_started:+ }$id"
      else
        concluded+="${concluded:+ }$id"
      fi
    fi
    if [ "$secs" -ge 0 ]; then dur="$((secs / 60))m $((secs % 60))s"; else dur="-"; fi
    if [ -n "$verdict" ]; then shown="$verdict"
    elif [ "$name" = E2E ] && [ "$saw_gate" = 1 ]; then shown="$cause"
    else shown="$cause; safe to retry"; fi
    rows+="| $name | $conclusion | $started | $ended | $dur | $steps | $shown |\n"
    echo "'$name': conclusion=$conclusion steps_run=$steps duration=$dur verdict=${verdict:-retryable}" >&2
    [ -n "$blocker" ] || [ -z "$verdict" ] || blocker="'$name' $verdict"
  done
  if [ -z "$rows" ]; then
    blocker="no failed, cancelled or unstarted jobs in this attempt"
  elif [ -z "$blocker" ] && [ "$saw_gate" = 1 ] && [ "$saw_shard" = 0 ]; then
    blocker="'E2E' gate is red but no shard failed in this attempt"
  fi
}

if [ "${CLASSIFY_ONLY:-0}" = 1 ]; then
  SUMMARY=/dev/null
  run_conclusion="${run_conclusion:-failure}"
  classify
  if [ -n "$blocker" ]; then echo "no retry: $blocker"; else echo "retry"; fi
  exit 0
fi

[ "$ATTEMPT" -le "$MAX_ATTEMPT" ] || skip "already retried $((ATTEMPT - 1)) times"
[ -n "$run_conclusion" ] ||
  run_conclusion=$(gh api "repos/$REPO/actions/runs/$RUN_ID" --jq '.conclusion // "-"')

# Every job that did not succeed, with the annotations GitHub attached to it.
# Not filtered on `.conclusion`: a job GitHub never concluded is exactly the
# case this has to see.
jobs=$(gh api --paginate "repos/$REPO/actions/runs/$RUN_ID/attempts/$ATTEMPT/jobs?per_page=100" \
  --jq '.jobs[]
    | select(.name != null)
    | select((.conclusion // "") as $c | $c != "success" and $c != "skipped")' |
  while IFS= read -r job; do
    id=$(jq -r '.id' <<<"$job")
    if [ "$(jq -r '.conclusion // "-"' <<<"$job")" = "-" ]; then
      # A job GitHub never concluded is judged from its own state, and its
      # annotations cannot change that verdict, so a check run that cannot be
      # read here is not evidence about anything. (It does answer 200 with an
      # empty list for run 43090680255's job, so this tolerance is a safety
      # net, not the normal path.)
      notes=$(gh api "repos/$REPO/check-runs/$id/annotations" \
        --jq '[.[] | {level: .annotation_level, message}]' 2>/dev/null || echo '[]')
    else
      # A job GitHub did conclude is judged by these annotations, so an error
      # reading them must abort the run: a failed read would look like "GitHub
      # attributed no cause" and turn a lost runner into a green, silent skip.
      notes=$(gh api "repos/$REPO/check-runs/$id/annotations" \
        --jq '[.[] | {level: .annotation_level, message}]')
    fi
    jq -c --argjson a "$notes" '.annotations = $a' <<<"$job"
  done)
classify <<<"$jobs"
[ -z "$blocker" ] || skip "$blocker"

run_number=$(gh api "repos/$REPO/actions/runs/$RUN_ID" --jq .run_number)
newer=$(gh api "repos/$REPO/actions/workflows/release.yml/runs?per_page=20" \
  --jq "[.workflow_runs[] | select(.run_number > $run_number) | .id]
    | if length > 0 then \"\(length) newer, latest \(.[0])\" else \"\" end")
[ -z "$newer" ] || skip "newer release run(s) exist ($newer); they will ship this commit's changes"

if [ "${DRY_RUN:-0}" = 1 ]; then
  plan=""
  [ -z "$concluded" ] || plan="the failed jobs"
  for id in $never_started; do plan="${plan:+$plan and }job $id"; done
  decision="DRY_RUN: would re-run $plan (retry $ATTEMPT of $MAX_ATTEMPT)"
  echo "$decision"
  exit 0
fi
# Failed jobs first (one new attempt covers all of them), then the jobs GitHub
# never started: those have no conclusion, so "re-run failed jobs" does not
# include them, and only the per-job endpoint reaches them (ENG-11624). That
# endpoint re-runs one job per call, and a call creates a new attempt, so GitHub
# can refuse the second unstarted job (it offers no call that re-runs several).
# Any job left un-retried therefore fails this job loudly with its id, where
# declining to retry used to be a green skip.
retried=""
if [ -n "$concluded" ]; then
  gh api -X POST "repos/$REPO/actions/runs/$RUN_ID/rerun-failed-jobs" >/dev/null
  retried="the failed jobs"
fi
not_rerun=""
for id in $never_started; do
  if gh api -X POST "repos/$REPO/actions/jobs/$id/rerun" >/dev/null; then
    retried="${retried:+$retried and }job $id"
  else
    not_rerun+="${not_rerun:+ }$id"
  fi
done
if [ -n "$not_rerun" ]; then
  decision="re-ran ${retried:-nothing}, but GitHub refused $not_rerun, which never started; re-run by hand"
  echo "::error::GitHub would not re-run job(s) $not_rerun from run $RUN_ID attempt $ATTEMPT${retried:+ (after re-running $retried)}. Re-run them by hand."
  exit 1
fi
decision="re-ran $retried (retry $ATTEMPT of $MAX_ATTEMPT)"
echo "::warning::Re-ran $retried of release run $RUN_ID (GitHub infra failure, retry $ATTEMPT of $MAX_ATTEMPT)"
