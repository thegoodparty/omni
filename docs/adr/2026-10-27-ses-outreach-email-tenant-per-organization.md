---
title: SES for outreach email; Mailgun stays transactional; one SES tenant per organization, with reputation numbers read from CloudWatch
status: active
decided_by: [stephtea]
date: 2026-10-27
code: ['#3313']
scope:
  - packages/gp-api/deploy/components/email-outreach.ts
  - packages/gp-api/src/emailOutreach/**
supersedes: []
superseded_by:
---

# SES for outreach email; Mailgun stays transactional; one SES tenant per organization, with reputation numbers read from CloudWatch

## Decision

Outreach email to a candidate's or official's contacts sends through Amazon SES
in `us-west-2`. Mailgun keeps sending transactional email. Each organization
sends as its own SES tenant, so SES can pause one organization instead of the
account. Bounce and complaint numbers come from SES's CloudWatch metrics, tagged
per send with `outreachEmailId`. We keep no bounce or complaint counters and
process no per-email SES events. SES's account suppression list handles bounces
and complaints; our table holds only unsubscribes.

## Context

SES production access is approved at 50,000 a day and 14 a second. Outreach
volume per send reaches the tens of thousands, and the shared SQS queue also
carries every other job. One queue message per email event would back up that
queue.

## Alternatives rejected

- **Mailgun for outreach.** Higher per-email cost at this volume, and it is
  already the transactional path we want kept separate from bulk reputation.
- **SES events through SNS into the queue.** One message per email, and it
  needs a queue change we have ruled out.
- **One shared tenant.** One organization's bad list would pause everyone.
- **Our own bounce counters.** Duplicates numbers SES already publishes.

## Revisit if

CloudWatch metric delay makes auto-pause too slow, or delivery, open or click
data is wanted. The answer for the latter is a Firehose destination to S3, never
SNS.
