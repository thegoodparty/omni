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

An upload is stuck when it is `processing` and the `contactUploadProcess`
job it was sent with (`contact_upload.process_job_id`, stored in the same
transaction as the status and the job) is no longer `created`, `retry` or
`active`. `ContactUploadStuckService.failStuck` marks those failed
(`transient`) with the reason and event the worker's last attempt uses. It
reads the `processing` uploads first, on the `(status, organization_slug)`
index, and only when there are any reads their jobs by `pgboss.job`'s
`(name, id)` primary key. It runs before email confirm counts imports and on
a 5-minute pg-boss schedule for every organization.

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
- **Find the job by its payload** (`data->>'uploadId'`). No index covers
  it, so every check would scan the queue's jobs.
- **Also run it on the uploads routes' reads.** The pages poll every 3
  seconds, so it would run far more often than it ever finds anything;
  confirm and the schedule are enough, and the pages catch up within 5
  minutes.

## Revisit if

The job moves off pg-boss, or an upload can be `processing` without a job
sent in the same transaction.
