---
title: A job requeued at shutdown cannot start again until the stopping task is dead
status: active
decided_by: [agent]
date: 2026-11-10
code: ['#3712']
scope:
  - packages/gp-api/src/jobs/**
supersedes:
  [2026-11-10-deploys-requeue-running-jobs-without-spending-an-attempt.md]
superseded_by:
---

# A job requeued at shutdown cannot start again until the stopping task is dead

## Decision

The rule of the record this supersedes stands: on SIGTERM `JobsService`
aborts every running job's `job.signal`, gives running jobs 20 seconds, and
puts a job that throws in that time, or is still running when it ends, back
in its queue at the attempt it was on (`retry`, `started_on` cleared). What
changes is the requeue's `start_after`: 60 seconds out, not 10. ECS kills a
stopping task 30 seconds after SIGTERM, and 60 is twice that, so a requeued
job can start on another task only once the stopping one is dead.
Mechanism: `packages/gp-api/src/jobs/AGENTS.md` § Shutdown.

## Context

A job still running when the grace ends is requeued while its handler keeps
running, until ECS kills the process 10 seconds later. With a 10-second
delay the job became claimable right around that kill, so a second run
could start beside a first one that was still writing. Cursor Bugbot found
this on #3722. The delay also still covers its first reason: the next claim
carries the attempt number this task's own settle of the job is fenced to,
and that settle has to find nothing first.

The cost is that a job interrupted by a deploy waits about a minute before
it resumes, and holds its `key_strict_fifo` group for that minute.

## Alternatives rejected

- **Keep 10 seconds and make every job safe beside a still-running copy.**
  Every worker would carry that burden, and most cannot.
- **A delay of just over the 10 seconds left after the grace.** The grace
  timer starts when `JobsService` begins shutting down, not at SIGTERM, and
  ECS's clock is not ours; a margin this thin can still overlap.

## Revisit if

The ECS stop timeout changes (`deploy/components/service.ts` sets none, so
it is ECS's default of 30 seconds): the delay must stay well past it.
