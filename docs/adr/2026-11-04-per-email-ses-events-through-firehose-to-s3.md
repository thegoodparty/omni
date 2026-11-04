---
title: Per-email SES events go through Firehose to S3 and a gp-api cron, never the queue
status: active
decided_by: [stephtea]
date: 2026-11-04
code: ['#PR']
scope:
  - packages/gp-api/deploy/components/email-events.ts
  - packages/gp-api/deploy/components/email-outreach.ts
supersedes: []
superseded_by:
---

# Per-email SES events go through Firehose to S3 and a gp-api cron, never the queue

## Decision

Delivery, bounce, complaint, open and click events for every outreach email
go from a second event destination on the `outreach-<env>` configuration set
into Kinesis Data Firehose, which writes gzipped JSON files to
`goodparty-ses-events-<env>`. A scheduled gp-api job reads new files every few
minutes and records each recipient's status and timestamps. Raw files expire
after 90 days. The CloudWatch destination stays as it is and the auto-pause
keeps reading it. Opens and clicks are tracked; the agent that built it chose
SES's default tracking domain for them.

This is the route the queue docs and
`2026-10-28-replies-by-sns-webhook-into-the-existing-queue.md` named for
per-email data.

## Context

The status page needs to show which recipients were delivered, bounced,
complained, opened and clicked. SES reports these only per event, at a volume
proportional to sends. gp-api's one SQS FIFO queue is shared with unrelated
jobs, and its consumers take one message per poll per task, so one message
per email would back up everything behind a large send.

## Alternatives rejected

- **SNS destination into the shared queue.** One queue message per email; the
  reason the replies record ruled it out.
- **SNS to a webhook that writes Postgres per event.** Same volume as HTTP
  requests against the web tasks, with nothing to batch or replay.
- **CloudWatch only.** Gives counts per send, not per recipient.
- **A custom tracking domain.** Keeping links on HTTPS needs CloudFront and a
  us-east-1 certificate; the default domain needs neither.

## Revisit if

Event volume makes a few-minute file sweep too slow for what the UI shows, or
email moves to a consumer of its own.
