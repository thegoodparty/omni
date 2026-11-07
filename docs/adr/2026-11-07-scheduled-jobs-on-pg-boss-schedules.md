---
title: gp-api scheduled work runs on pg-boss schedules and fans out per record
status: active
decided_by: [swain]
date: 2026-11-07
code: ['#PR']
scope:
  - packages/gp-api/src/jobs/**
  - packages/gp-api/src/campaigns/tasks/services/weeklyTasksDigest*.ts
supersedes: []
superseded_by:
---

# gp-api scheduled work runs on pg-boss schedules and fans out per record

## Decision

Scheduled work in gp-api moves from NestJS `@Cron` plus the `cron_run` lock
table to pg-boss schedules, declared in `SCHEDULES` in
`src/jobs/jobs.registry.ts` next to `JOBS`. Each schedule has its own queue,
set up like a job's, and no payload. Every run of a schedule shares one group,
so runs never overlap, and an occurrence missed while no task ran runs once
afterwards. Schedules are synced with the code at boot.

A scheduled job that touches many records does not loop over them. It sends
one job per record with `sendMany`, whose job ids come from a key per record
and occurrence, so each record retries, dead-letters and alerts on its own.
Every scheduled job must be safe to run twice. The weekly tasks digest moves
first.

## Context

`@Cron` fires on every gp-api task, so each job had to dedupe itself: a
hand-maintained lock table with stale-claim takeover, or, for the weekly
digest, an SQS message whose 5-minute deduplication window collapsed the
copies. Batch crons looped over every record in one pass, so a failure was
logged and skipped, with no retry and no alert, and each batch carried its
own throttling. pg-boss already runs in the gp-api database, sends one job
per occurrence across tasks, and gives every queue retries, dead letters,
metrics and alerts.

## Alternatives rejected

- **Keep `@Cron` with `CronLockService`.** Every job keeps reimplementing
  dedupe and per-record error handling, and failures stay invisible.
- **A shared queue for all schedules with the schedule name in the payload.**
  One slow schedule would back up the rest, and alerts could not say which
  schedule is behind.
- **Let a schedule's worker do the work for every record itself.** One record's
  failure retries the whole batch or is swallowed, which is the problem this
  replaces.

## Revisit if

A job needs sub-minute precision, or fan-out volume puts measurable load on
the gp-api database.
