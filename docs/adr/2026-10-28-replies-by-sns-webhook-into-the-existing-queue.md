---
title: Replies by SNS webhook into the existing queue; no per-email SES events on the queue
status: active
decided_by: [agent]
date: 2026-10-28
code: ['#PR']
scope:
  - packages/gp-api/src/emailOutreach/services/emailSnsWebhook.service.ts
  - packages/gp-api/src/emailOutreach/services/outreachEmailInbound.service.ts
  - packages/gp-api/src/queue/queue.types.ts
supersedes: []
superseded_by:
---

# Replies by SNS webhook into the existing queue; no per-email SES events on the queue

## Decision

A reply to an outreach email arrives through SES inbound: a receipt rule writes
the raw message to S3 and notifies an SNS topic, and SNS posts to
`POST /v1/email/webhooks/sns`. The webhook verifies the SNS signature (the
signing certificate must be on `sns.us-west-2.amazonaws.com`), accepts only this
environment's inbound topic (`EMAIL_INBOUND_TOPIC_ARN`), and enqueues one
`emailInbound` message with `throwOnError: true`. It answers 200 only after the
enqueue succeeds, so SNS retries a failure. All processing happens in the queue
handler. The queue itself is not reconfigured.

Sends, bounces, complaints, deliveries, opens and clicks never produce queue
messages. Bounce and complaint numbers are read from SES's CloudWatch metrics.
If delivery, open or click data is ever wanted, it goes through a Firehose
event destination to S3.

## Context

Replies are rare next to sends: a few per hundred recipients. Per-email events
would be one message per email, and the shared FIFO queue's consumers take one
message per poll per task, so a large send would back up every other job. Other
systems already send to this queue, which is why its encryption and
deduplication settings stay as they are.

## Alternatives rejected

- **SES events by SNS into the queue for every email.** Volume proportional to
  sends, on a queue shared with unrelated jobs.
- **Parsing replies inside the webhook request.** SNS expects an answer within
  seconds, and a parse or forward failure would be lost instead of retried.
- **A second queue for email.** The queue architecture is one queue switched on
  `QueueType`.

## Revisit if

Reply volume grows enough to crowd the queue, or email moves to its own
consumer.
