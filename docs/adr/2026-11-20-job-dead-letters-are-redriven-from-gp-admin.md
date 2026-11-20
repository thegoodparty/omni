---
title: A job dead letter is redriven through gp-admin, and the queue comes from the dead letter itself
status: active
decided_by: [swain]
date: 2026-11-20
code: ['#0']
scope:
  - packages/gp-api/src/admin/jobDeadLetters/**
  - packages/gp-admin/src/app/dashboard/job-dead-letters/**
  - packages/contracts/src/jobs/**
supersedes: []
superseded_by:
---

# A job dead letter is redriven through gp-admin, and the queue comes from the dead letter itself

## Decision

A staff member reads and redrives a pg-boss dead letter from gp-admin, through
gp-api's `admin/job-dead-letters`, instead of from a shell with
`DATABASE_URL` for the environment. Both endpoints sit behind
`AdminOrM2MGuard`, so an admin session or an M2M token; gp-admin gates the
page on the existing `org:admin` role rather than a new Clerk permission.

The route a redrive takes is not a parameter. pg-boss records the queue a job
failed on as `source_name` when it moves the job into `<queue>-dlq`, and both
the list's `sourceQueue` and the redrive's destination come from that field, so
a caller cannot put a payload on a queue it was never built for. A dead letter
with no recorded source is listed and refused with 404.

The redrive is pg-boss's own single-statement move, so it is atomic: a second
redrive of the same dead letter finds nothing to move and answers 404 rather
than queueing the job twice. There is no batch move; the shell script keeps
that.

## Context

`scripts/jobs-dead-letter.ts` was the only recovery path, and it needs
`DATABASE_URL`, which for prod is a production database credential handed to
whoever is on the incident. Dead letters are routine enough to page (`jobs-dead-letter`
in `src/jobs/AGENTS.md` § Metrics, dashboard and alerts) that the recovery path
should not be the rare thing. gp-admin already holds a gp-api credential for
staff that has nothing to do with database access.

## Alternatives rejected

- **A new Clerk permission for dead letters.** The audience is exactly the
  admins who already run the SMS console and email sends, and both of those
  gate on `org:admin`. A permission nobody was asking to grant separately is a
  dashboard change and a Clerk deploy for no new boundary.
- **Let the caller name the destination queue.** It makes a mistyped queue, or
  a stale one, a way to run a payload under a worker that does not expect it.
  The provenance is already recorded on the row; reading it is both simpler and
  the only safe default.
- **Re-`send()` the payload onto the queue.** Two statements, so a concurrent
  redrive can duplicate the job, and the dead letter has to be deleted
  separately, which can half-fail.

## Revisit if

Redriving becomes a routine batch operation, or source queues are renamed often
enough that `source_name` goes stale while dead letters are still worth replaying.
