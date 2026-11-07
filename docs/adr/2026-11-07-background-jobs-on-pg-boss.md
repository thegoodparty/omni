---
title: gp-api background jobs run on pg-boss in the gp-api database
status: active
decided_by: [swain]
date: 2026-11-07
code: ['#3676']
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
Every job is declared in one registry (`src/jobs/jobs.registry.ts`) with a
Zod payload schema that types `send()` and the handler, and checks the data
on both sides. `send()` takes a Prisma transaction, so a status change and
its job commit together. Every queue has a dead-letter queue that alerts.
Contact imports are the first job to move, and run as one job per upload
instead of one SQS message per chunk.

## Context

The SQS FIFO queue could not run in tests, could not join a database
transaction (an upload could be `processing` with no job), and needed
chunking to stay under its visibility timeout. pg-boss uses the database we
already run, works with several tasks at once (`SKIP LOCKED` claims,
advisory-locked maintenance), retries with backoff, dead-letters, limits
concurrency per group across tasks, and emits OpenTelemetry spans that
continue the sending request's trace.

## Alternatives rejected

- **Stay on SQS.** No transactional enqueue and no worker in tests.
- **Inngest and other hosted runners.** Another vendor and another network
  hop for work whose state is all in our database.
- **A separate database for pg-boss.** Jobs could not join the app's
  transactions.

## Revisit if

Job volume puts measurable load on the gp-api database, or workers need to
scale apart from the API.
