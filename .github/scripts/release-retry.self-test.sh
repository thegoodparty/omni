#!/usr/bin/env bash
# Fixture test for release-retry.sh's classifier (ENG-11624). release-retry.sh
# runs this before it trusts the classifier on a real release run, the same way
# judge-comment.yml self-tests judge-comment-parse.sh and judge-guard.yml
# self-tests judge-path-floor.sh: an edit that breaks a verdict fails a run with
# a clear reason instead of quietly declining to retry the next lost release.
#
# Each case is a table of synthetic jobs-API records in, one decision out.
# CLASSIFY_ONLY=1 makes the script read those records on stdin and print the
# decision with no API call, so a case is readable as data: what each job's
# state and annotations were, and what the classifier then does.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
script="$here/release-retry.sh"
export REPO=example/repo RUN_ID=1 ATTEMPT=1
failures=0

# expect <want> <label> [job json...]. RUN_CONCLUSION is read from the caller's
# environment, so a case can say how the run itself concluded.
expect() {
  local want="$1" label="$2" got
  shift 2
  got="$(printf '%s\n' "$@" | CLASSIFY_ONLY=1 bash "$script")"
  if [ "$got" = "$want" ]; then
    echo "ok   $got  | $label"
  else
    echo "FAIL $got (want $want)  | $label"
    failures=$((failures + 1))
  fi
}

# The run this ticket is about: GitHub closed the run as failed during an
# Actions outage while "Record prod deployment" was still queued, with no step
# and no conclusion. It never started, so re-running it cannot repeat a failure.
expect retry 'the queued job that lost run 43090680255 its deployment record' \
  '{"id":130781977353,"name":"Record prod deployment","status":"queued","conclusion":null,"steps":[],"started_at":"2026-11-11T20:19:53Z","completed_at":null,"annotations":[]}'

# The same job in a run that concluded cancelled: a cancel is a decision, not a
# lost runner, so it is never retried.
RUN_CONCLUSION=cancelled expect \
  "no retry: 'Record prod deployment' left queued when a run that did not fail concluded, so not a lost runner" \
  'a queued job in a run that concluded cancelled is not retried' \
  '{"id":1,"name":"Record prod deployment","status":"queued","conclusion":null,"steps":[],"started_at":"2026-11-11T20:19:53Z","completed_at":null,"annotations":[]}'

# A job still running when the run was closed has an unknown outcome; a person
# looks at it rather than the bot re-running it.
expect "no retry: 'Promote gp-webapp' left 'in_progress' with no conclusion; its outcome is unknown" \
  'a job with no conclusion that had started is not assumed safe' \
  '{"id":2,"name":"Promote gp-webapp","status":"in_progress","conclusion":null,"steps":[{"name":"Set up job"}],"started_at":"2026-11-11T20:19:53Z","completed_at":null,"annotations":[]}'

expect retry 'a lost runner in a stateless job' \
  '{"id":3,"name":"Promote gp-webapp","status":"completed","conclusion":"failure","steps":[{"name":"Set up job"},{"name":"Deploy"},{"name":"Complete job"}],"started_at":"2026-11-11T20:00:00Z","completed_at":"2026-11-11T20:05:00Z","annotations":[{"level":"failure","message":"The hosted runner lost communication with the server"}]}'

# A Pulumi/Terraform job that lost its runner after it started may hold a state
# lock, so it is never retried.
expect "no retry: 'Promote gp-api' lost its runner mid-run and holds deploy state; check its lock and re-run by hand" \
  'a lost runner in a deploy-state job is not retried' \
  '{"id":4,"name":"Promote gp-api","status":"completed","conclusion":"failure","steps":[{"name":"Set up job"},{"name":"pulumi up"},{"name":"Complete job"}],"started_at":"2026-11-11T20:00:00Z","completed_at":"2026-11-11T20:05:00Z","annotations":[{"level":"failure","message":"The hosted runner lost communication with the server"}]}'

expect retry 'the environment lookup that failed before any step (ENG-11600)' \
  '{"id":5,"name":"Promote gp-admin","status":"completed","conclusion":"failure","steps":[{"name":"Set up job"},{"name":"Complete job"}],"started_at":"2026-11-05T23:23:46Z","completed_at":"2026-11-05T23:24:34Z","annotations":[{"level":"failure","message":"Unable to fetch the information for the environment production targeted by this job."}]}'

expect "no retry: 'Promote gp-admin' failed for a reason other than a lost runner" \
  'an environment lookup after steps ran is not a job that never started' \
  '{"id":6,"name":"Promote gp-admin","status":"completed","conclusion":"failure","steps":[{"name":"Set up job"},{"name":"Deploy"},{"name":"Complete job"}],"started_at":"2026-11-05T23:23:46Z","completed_at":"2026-11-05T23:24:34Z","annotations":[{"level":"failure","message":"Unable to fetch the information for the environment production targeted by this job."}]}'

expect retry 'a dead runner cut off by timeout-minutes before any step' \
  '{"id":7,"name":"Promote gp-ai","status":"completed","conclusion":"cancelled","steps":[{"name":"Set up job"},{"name":"Complete job"}],"started_at":"2026-10-30T15:37:35Z","completed_at":"2026-10-30T16:24:35Z","annotations":[{"level":"error","message":"The job running on runner hosted-1 has exceeded the maximum execution time of 45 minutes."}]}'

expect "no retry: 'Promote experiment manifests' timed out after steps ran, so a slow or hung job, not a dead runner" \
  'a timeout after steps ran is never retried' \
  '{"id":8,"name":"Promote experiment manifests","status":"completed","conclusion":"failure","steps":[{"name":"Set up job"},{"name":"Deploy"},{"name":"Complete job"}],"started_at":"2026-10-31T17:23:43Z","completed_at":"2026-10-31T18:08:43Z","annotations":[{"level":"error","message":"The job running on runner hosted-1 has exceeded the maximum execution time of 45 minutes."}]}'

expect retry 'a job that never started is retried next to an unrelated stateless loss' \
  '{"id":9,"name":"E2E Shard (2)","status":"completed","conclusion":"failure","steps":[{"name":"Set up job"},{"name":"Run playwright"},{"name":"Complete job"}],"started_at":"2026-11-11T20:00:00Z","completed_at":"2026-11-11T20:05:00Z","annotations":[{"level":"failure","message":"The hosted runner lost communication with the server"}]}' \
  '{"id":90,"name":"Record prod deployment","status":"queued","conclusion":null,"steps":[],"started_at":"2026-11-11T20:19:53Z","completed_at":null,"annotations":[]}'

# The E2E gate is red whenever a shard is, so a lost-runner shard retries and
# the gate goes with it.
expect retry 'E2E gate red because a shard lost its runner' \
  '{"id":10,"name":"E2E Shard (2)","status":"completed","conclusion":"failure","steps":[{"name":"Set up job"},{"name":"Run playwright"},{"name":"Complete job"}],"started_at":"2026-11-11T20:00:00Z","completed_at":"2026-11-11T20:05:00Z","annotations":[{"level":"failure","message":"The hosted runner lost communication with the server"}]}' \
  '{"id":11,"name":"E2E","status":"completed","conclusion":"failure","steps":[{"name":"Set up job"},{"name":"Gate"},{"name":"Complete job"}],"started_at":"2026-11-11T20:05:00Z","completed_at":"2026-11-11T20:06:00Z","annotations":[{"level":"failure","message":"E2E shards result: failure"},{"level":"failure","message":"Process completed with exit code 1."}]}'

# A red gate with no red shard in the attempt is not understood, so nothing is
# retried.
expect "no retry: 'E2E' gate is red but no shard failed in this attempt" \
  'E2E gate red with no shard in the list' \
  '{"id":12,"name":"E2E","status":"completed","conclusion":"failure","steps":[{"name":"Set up job"},{"name":"Gate"},{"name":"Complete job"}],"started_at":"2026-11-11T20:05:00Z","completed_at":"2026-11-11T20:06:00Z","annotations":[{"level":"failure","message":"E2E shards result: skipped"},{"level":"failure","message":"Process completed with exit code 1."}]}'

# A run whose attempt shows no judged job at all: every job green, or a run
# GitHub reports without jobs (a cancelled one does).
expect 'no retry: no failed, cancelled or unstarted jobs in this attempt' \
  'an attempt with nothing to judge' 

# A real code failure is a real code failure.
expect "no retry: 'Dev gp-ai' failed for a reason other than a lost runner" \
  'a real code failure' \
  '{"id":13,"name":"Dev gp-ai","status":"completed","conclusion":"failure","steps":[{"name":"Set up job"},{"name":"terraform apply"},{"name":"Complete job"}],"started_at":"2026-11-11T20:00:00Z","completed_at":"2026-11-11T20:05:00Z","annotations":[]}'

# Both shapes in one attempt: the concluded failure and the job GitHub never
# concluded are both retryable, so the attempt is retried.
expect retry 'a concluded failure next to a job GitHub never started' \
  '{"id":14,"name":"Promote gp-admin","status":"completed","conclusion":"failure","steps":[{"name":"Set up job"},{"name":"Deploy"},{"name":"Complete job"}],"started_at":"2026-11-11T20:00:00Z","completed_at":"2026-11-11T20:05:00Z","annotations":[{"level":"failure","message":"The hosted runner lost communication with the server"}]}' \
  '{"id":15,"name":"Promote candidate-sites","status":"queued","conclusion":null,"steps":[],"started_at":"2026-11-11T20:05:53Z","completed_at":null,"annotations":[]}'

# One real failure next to a retryable one: the attempt is not retried, and the
# reason names the failure.
expect "no retry: 'Dev gp-webapp' failed for a reason other than a lost runner" \
  'one real failure blocks the whole attempt' \
  '{"id":16,"name":"Promote gp-admin","status":"queued","conclusion":null,"steps":[],"started_at":"2026-11-11T20:05:53Z","completed_at":null,"annotations":[]}' \
  '{"id":17,"name":"Dev gp-webapp","status":"completed","conclusion":"failure","steps":[{"name":"Set up job"},{"name":"build"},{"name":"Complete job"}],"started_at":"2026-11-11T20:00:00Z","completed_at":"2026-11-11T20:05:00Z","annotations":[]}'

if [ "$failures" -gt 0 ]; then
  echo "$failures case(s) failed"
  exit 1
fi
echo "all cases passed"
