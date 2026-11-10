---
title: A processing contact upload with no live pg-boss job is failed, not timed out
status: active
decided_by: [agent]
date: 2026-11-10
code: ['#3691']
scope:
  - packages/gp-api/src/contactUploads/**
  - packages/gp-api/src/emailOutreach/services/outreachEmailConfirm.service.ts
supersedes: []
superseded_by:
---

# A processing contact upload with no live pg-boss job is failed, not timed out

## Decision

An upload is stuck when it is `processing` and no `contactUploadProcess` job
for it is `created`, `retry` or `active` in `pgboss.job`.
`ContactUploadStuckService.failStuck` marks those failed (`transient`) in one
`UPDATE`, through the same reason and event the worker's last attempt uses.
It runs before the uploads routes read, before email confirm counts imports,
and on a 5-minute pg-boss schedule for every organization.

## Context

Email confirm waits for an organization's imports, so an upload left
`processing` forever blocks its email. That happens only when pg-boss gives
up on the job without the worker's failure path running: the last attempt
lost to a crash, a missed heartbeat, the timeout or a shutdown. Confirm and
retry set `processing` and send the job in one transaction, so a
`processing` upload with no live job has nothing left that will move it.

## Alternatives rejected

- **No progress for N minutes.** An upload can wait correctly with no
  progress: behind the organization's other upload (the queue is FIFO per
  org) or on a retry's backoff. Any window short enough to unblock email
  soon would fail healthy uploads, and one long enough not to would block
  email for hours.
- **Only the schedule.** Email and the Contacts pages would see a dead
  upload as processing for up to 5 minutes after pg-boss gave up.

## Revisit if

The job moves off pg-boss, or an upload can be `processing` without a job
sent in the same transaction.
