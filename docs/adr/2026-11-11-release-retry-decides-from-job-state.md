---
title: The release retry decides from each job's own state, not GitHub's verdict
status: active
decided_by: [agent]
date: 2026-11-11
code: ['#3749']
scope:
  - .github/scripts/release-retry.sh
  - .github/workflows/release-retry.yml
supersedes: []
superseded_by:
---

# The release retry decides from each job's own state, not GitHub's verdict

## Decision

`release-retry.yml` re-runs a release run's jobs only when every job that did not
succeed either never started or provably lost its runner. It picks the jobs to
judge by state — anything not `success` or `skipped`, including a job GitHub
closed the run without concluding — and decides from what the job did. A job with
no step run that is still `queued` when the run is closed never got a runner, so
it is re-run by id (`POST /actions/jobs/{id}/rerun`; "re-run failed jobs" only
reaches jobs GitHub concluded as failed). GitHub's annotation strings stay the
evidence only for a job that started and then died, where nothing local separates
a dead runner from a red test.

## Context

During the Actions outage of 2026-11-11, GitHub closed release run 43090680255 as
failed while "Record prod deployment" had been `queued` since 20:19:53Z: no step,
no log, no annotation, and no conclusion. Because the classifier selected on
`conclusion == failure|cancelled`, that job was invisible, the retry declined
with "no failed or cancelled jobs in this attempt", and prod stayed promoted with
no deployment record for the SHA (ENG-11624). The mechanism shipped on Nov 2 as a
chain of one-off cases — a lost runner, a timeout before any step, an environment
lookup that failed before any step — each adding one more annotation string, and
it had not once re-run a job in the eight failed release runs since. The guard
that keeps it safe was already state-based ("ran no step past Set up job"); only
the selection was keyed on GitHub's vocabulary.

## Alternatives rejected

- Add "queued with no conclusion" as another case inside the existing selector:
  a selector keyed on conclusion cannot see a job that has none, so no case
  inside it is reachable.
- Keep `rerun-failed-jobs` as the only retrying call: it re-runs jobs GitHub
  concluded as failed, so a job it never concluded is not re-run at all.
- Re-run the whole run (`POST /runs/{id}/rerun`): that re-runs every prod
  promotion, not just the lost job.
- A reconciliation that backfills a missing deployment record from the promoted
  SHA: the sturdier long-term shape, but it needs a decision about what is
  authoritative for "what is in prod", so it is a follow-up, not this change.

## Revisit if

GitHub starts concluding a job it never started, or exposes a per-job state that
does not need to be inferred from status and step count.
