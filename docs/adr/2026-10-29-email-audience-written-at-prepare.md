---
title: An email send's audience is written at prepare, in cursor-resumed queue deliveries
status: active
decided_by: [agent]
date: 2026-10-29
code: ['#3424']
scope:
  - packages/gp-api/src/emailOutreach/services/outreachEmailAudience.service.ts
  - packages/gp-api/src/emailOutreach/services/outreachEmailPrepare.service.ts
  - packages/gp-api/prisma/schema/outreachEmail.prisma
---

# An email send's audience is written at prepare, in cursor-resumed queue deliveries

## Decision

An email send targets a saved voter-file list with `hasEmail` forced. Confirm
counts it with one people-DB statement and freezes the cap; nobody is
resolved in the request. The `emailSendPrepare` step writes the recipients:
keyset pages of 10,000 (`afterId`), one insert per page that skips anyone
already on the send, stopping once the cap has that many people who are
neither unsubscribed nor emailed by this sender before. A delivery stops
starting pages after 150 seconds, saves `outreach_email.audience_cursor`,
and enqueues the same message again (deduplicated on the cursor). A
compare-and-set on the cursor stops a second chain.

## Context

Lists run to hundreds of thousands of people and the top warming cap is
250,000, so a resolve can need many Databricks pages. The shared SQS queue has a
5-minute visibility timeout and must not be reconfigured. Recipients sort by
this sender's send history, which lives in Postgres, so the ordering cannot be
pushed into the warehouse query; but never-emailed people sort first, which
lets the resolve stop early.

## Alternatives rejected

- Resolve at confirm, inside the request: a large list hits request and
  Databricks timeouts, and the user waits on it.
- One long prepare delivery: it outlives the visibility timeout and is
  redelivered while still running.
- Extending visibility with heartbeats: more moving parts on a queue other
  systems share, for the same result.
- OFFSET paging: every page re-sorts and skips everything before it.

## Revisit if

The people DB gains the sender's email history, so the least-recently-emailed
ordering and the cap could be one warehouse query.
