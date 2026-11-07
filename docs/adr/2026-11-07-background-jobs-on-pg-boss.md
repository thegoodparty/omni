---
title: gp-api background jobs run on pg-boss in the gp-api database
status: active
decided_by: [swain]
date: 2026-11-07
code: ['#3677']
scope:
  - packages/gp-api/src/jobs/**
  - packages/gp-api/src/queue/**
supersedes: []
superseded_by:
---

# gp-api background jobs run on pg-boss in the gp-api database

## Decision

New background work inside gp-api runs on pg-boss, a Postgres job queue, in
the `pgboss` schema of the gp-api database. Workers run in every gp-api task.

Every job is declared once, in `src/jobs/jobs.registry.ts`: a Zod payload
schema that types `send()` and the worker and is checked on both sides, the
worker itself, and four settings (backed-up alert threshold, timeout,
attempts, per-task concurrency). Workers are functions outside Nest
providers that reach the services they need through the app. Everything
else is the same for every queue.

Every queue is FIFO per group, like SQS FIFO (pg-boss `key_strict_fifo`):
`send()` takes an optional group; one group runs one job at a time in send
order, and a job with no group is its own group. Because pg-boss holds a
group while it has a failed job, finished jobs are deleted after a minute,
so a group moves on about two minutes after a dead letter. A job's history
lives in structured logs `JobsService` writes for every step, and a dead
letter keeps its payload and error for 14 days.

`send()` takes a Prisma transaction, so a status change and its job commit
together. Every queue gets the same metrics, dashboard, and two alerts: a
backed-up queue and a dead letter, once per queue. Contact imports are the
first job to move.

## Context

The SQS FIFO queue could not run in tests, could not join a database
transaction (an upload could be `processing` with no job), and needed
chunking to stay under its visibility timeout. pg-boss uses the database we
already run, works with several tasks at once (`SKIP LOCKED` claims,
advisory-locked maintenance), retries with backoff, dead-letters, limits
concurrency per group across tasks, and emits OpenTelemetry spans that
continue the sending request's trace.

## Alternatives rejected

- **pg-boss groups (`groupConcurrency`) for ordering.** One job per group at
  a time, but a later job overtakes one waiting on a retry: not FIFO.
- **Keeping finished jobs 7 days under strict FIFO.** A dead letter would
  hold its group until a developer deleted the failed job.

- **Stay on SQS.** No transactional enqueue and no worker in tests.
- **Inngest and other hosted runners.** Another vendor and another network
  hop for work whose state is all in our database.
- **A separate database for pg-boss.** Jobs could not join the app's
  transactions.

## Revisit if

Job volume puts measurable load on the gp-api database, or workers need to
scale apart from the API.
