---
title: gp-api has no @Cron, no @Interval and no SQS job of its own
status: active
decided_by: [swain]
date: 2026-11-10
code: ['#3753']
scope:
  - packages/gp-api/src/**
  - packages/gp-api/scripts/check-legacy-background-work.ts
supersedes: []
superseded_by:
---

# gp-api has no @Cron, no @Interval and no SQS job of its own

## Decision

Once every gp-api job and schedule ran on pg-boss, the old mechanisms were
removed and banned rather than left to shrink. CI
(`check-legacy-background-work.ts`) fails on any `@Cron` or `@Interval` in
`packages/gp-api/src`, and on any `QueueType` value outside the five messages
other systems send. The SQS producer, `CronLockService` and its `cron_run`
table are deleted. Work on one task's own memory, such as the sessions flush,
is a plain timer in that service's lifecycle hooks, not a schedule.
`@nestjs/schedule` stays only for `@Timeout(0)` startup hooks.

## Context

The pg-boss ports (`2026-11-07-background-jobs-on-pg-boss.md`,
`2026-11-07-scheduled-jobs-on-pg-boss-schedules.md`,
`2026-11-10-sqs-is-an-inbox-forwarded-to-pg-boss.md`) left a ratchet that
allowed the remaining `@Interval` and the internal `QueueType` values, plus a
one-release forwarder per ported type. With the ports shipped, an exception
list only invited new entries.

## Alternatives rejected

- **Keep the ratchet with a baseline.** Review would see a raised count, but
  each exception reopens the per-replica dedupe and no-alert problems the
  ports removed.
- **Allow `@Cron` for jobs that need a seconds field.** None remain; the two
  that had one run every minute on pg-boss.

## Revisit if

A job needs sub-minute precision that a pg-boss schedule cannot give.
