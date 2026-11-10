---
title: A gp-api task shutting down requeues its running jobs without spending an attempt
status: active
decided_by: [swain]
date: 2026-11-10
code: ['#3712']
scope:
  - packages/gp-api/src/jobs/**
supersedes: []
superseded_by:
---

# A gp-api task shutting down requeues its running jobs without spending an attempt

## Decision

A deploy or scale-in never spends a pg-boss job's attempt. On SIGTERM
`JobsService` aborts every running job's `job.signal` and gives running
jobs 20 seconds. A job that throws in that time, or is still running when
it ends, goes back to its queue at the attempt it was on: one `UPDATE`,
scoped to the ids and attempts this task holds, sets it to `retry` with
`started_on` cleared (pg-boss adds an attempt on a claim only when
`started_on` is set) and `start_after` 10 seconds out. This lives in the
job system, for every job, not in each worker. Mechanism and limits:
`packages/gp-api/src/jobs/AGENTS.md` § Shutdown.

## Context

pg-boss's graceful `stop()` waits its timeout, then fails every job still
running, which spends an attempt. Background agent runs (10 to 60 minutes)
and other long jobs are moving onto pg-boss, and gp-api deploys several
times a day, so a long job could dead-letter from deploys alone. Raising
`attempts` per job hides real failures behind the same headroom.

`retry` rather than `created` keeps a `key_strict_fifo` group held until
the job runs again. The 10-second delay is there because the next claim
carries the same attempt number that the stopping task's own settle of the
job is fenced to; the settle runs at once and must find nothing to settle.
pg-boss's stop timeout is set 5 seconds past ours, so its own fail runs
only if the requeue failed.

## Alternatives rejected

- **More `attempts` per job.** Every long job pays for it, and a job that
  really fails takes longer to dead-letter.
- **Let pg-boss fail the job, then undo the fail.** On a last attempt the
  fail has already dead-lettered the job, and between the two statements
  another task can claim it.
- **Requeue as `created` with no delay.** A job behind it in its group
  could run first, and the stopping task's settle could land on the new
  claim.

## Revisit if

pg-boss gains a stop mode that returns active jobs without counting an
attempt.
