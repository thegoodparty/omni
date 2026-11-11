---
title: Email replies and send prepares run as pg-boss jobs; a reply job carries only SES's message id
status: active
decided_by: [agent]
date: 2026-11-10
code: ['#3721']
scope:
  - packages/gp-api/src/emailOutreach/services/emailSnsWebhook.service.ts
  - packages/gp-api/src/emailOutreach/services/outreachEmailInbound.service.ts
  - packages/gp-api/src/emailOutreach/services/outreachEmailPrepare.service.ts
  - packages/gp-api/src/emailOutreach/services/outreachEmailAudience.service.ts
supersedes:
  - 2026-10-28-replies-by-sns-webhook-into-the-existing-queue.md
  - 2026-10-29-email-audience-written-at-prepare.md
superseded_by:
---

# Email replies and send prepares run as pg-boss jobs; a reply job carries only SES's message id

## Decision

The SNS webhook (`POST /v1/email/webhooks/sns`) still verifies the signature,
certificate host and topic and does no processing, but it sends an
`emailInbound` pg-boss job instead of an SQS message, and answers 200 only once
the job is committed. The job carries SES's message id and DMARC verdict, not
the bucket and key: the receipt rule stores each reply in this environment's
bucket under its message id with no prefix, so the worker reads
`EMAIL_INBOUND_BUCKET`/`<message id>`. The webhook ignores a notification that
names another bucket or another key.

An email send's audience is still written at prepare, a keyset page at a time,
by deliveries that stop after 150 seconds and resume from
`outreach_email.audience_cursor`, with a compare-and-set on the cursor so a
second delivery writes nothing. Each delivery is an `emailSendPrepare` job in
the send's group, so the next one starts only after the last has finished. The
due sweep sends the first in the same transaction as the send's start. Sends,
bounces, complaints, deliveries, opens and clicks still never become jobs or
queue messages.

## Context

gp-api's own background work moves to pg-boss
(`2026-11-07-background-jobs-on-pg-boss.md`), and job payloads are logged, so
they hold identifiers only. The SQS queue's 5-minute visibility timeout, which
set the delivery budget, no longer applies; the budget stays so one job stays
short and a deploy interrupts at most one delivery. The `emailSendPrepare` and
`emailInbound` SQS cases forward a message the previous release left in the
queue to its job for one release.

## Alternatives rejected

- **Keep the bucket and key in the reply job.** The bucket is always this
  environment's, and the key is the message id, so they add nothing but a
  second place to check.
- **A row per reply holding the S3 location, with the job carrying its id.** A
  table and a migration to store what the message id already names.
- **One prepare job for the whole audience.** A large list runs for many
  minutes, and every deploy would restart it.

## Revisit if

The receipt rule gains an object key prefix, or replies are stored anywhere
but this environment's bucket.
