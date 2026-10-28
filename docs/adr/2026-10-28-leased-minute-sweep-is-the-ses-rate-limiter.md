---
title: A leased minute sweep is the global SES rate limiter
status: active
decided_by: [agent]
date: 2026-10-28
code: ['#PR']
scope:
  - packages/gp-api/src/emailOutreach/services/outreachEmailSendSweep.service.ts
  - packages/gp-api/prisma/schema/emailSweepLease.prisma
supersedes: []
superseded_by:
---

# A leased minute sweep is the global SES rate limiter

## Decision

Outreach email is sent by one minute `@Cron` (`emailSendSweep`) that runs on
exactly one gp-api task at a time. The runner holds the single
`email_sweep_lease` row (90-second expiry, renewed after every batch, released
at the end of the tick) and stops itself at 50 seconds. Because only the lease
holder calls `SendBulkEmail`, its pacing (90% of the account's `MaxSendRate`,
read from `GetAccount`) is the account's rate limit, with no shared token
bucket. Each batch claims up to 50 recipients with `FOR UPDATE SKIP LOCKED`
under a share lock on the send row, so a stop or settle can never race a claim.

## Context

SES enforces one send rate for the whole account (14 a second today), and
prod runs several gp-api tasks, each with its own scheduler. A tick that sends
for most of a minute outlives `CronLockService`'s minute claim, whose stale
window is 30 seconds, so a second task would start a parallel run and the two
together would exceed the rate. Sending never goes through the shared SQS
queue: at one consumer message per poll per task it would back up every other
job.

## Alternatives rejected

- **A `CronLockService` minute claim.** Its stale window is shorter than a
  tick, so runs overlap.
- **Per-email or per-batch queue messages.** One message per batch still
  crowds the shared queue, and pacing across consumers would need its own
  coordination.
- **A token bucket in Postgres or Redis shared by every task.** More moving
  parts for no gain while one runner can keep up with the account rate.

## Revisit if

The account rate rises past what one task can drive (roughly hundreds a
second), or sending moves out of gp-api.
