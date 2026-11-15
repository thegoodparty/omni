---
title: A text send stranded in in_progress is re-claimed on redelivery by a stamped, conditional update
status: superseded
decided_by: [agent]
date: 2026-11-11
code: ['#3743']
scope:
  - packages/gp-api/src/outreach/services/outreachTextDelivery.service.ts
supersedes: []
superseded_by: 2026-11-11-text-send-reclaim-on-pg-boss-retry.md
---

# A text send stranded in in_progress is re-claimed on redelivery by a stamped, conditional update

## Decision

`Outreach.sendClaimedAt` records when a worker claimed a text send. A
redelivery may take over an `in_progress` row only if its stamp is older than
the SQS visibility timeout and the row has no recipient rows and no hand-off
row, in one `updateMany` on the exact old stamp. A send re-checks it still
holds its own stamp just before the Slack post and stops if not. Reverts are
scoped to the caller's own stamp. Null stamps and expansions are never
re-claimed.

## Context

A worker killed after the claim (deploy, OOM) leaves the row `in_progress`
with nothing written. SQS redelivers, the `pending -> in_progress` claim
matches nothing, and the send is acked as `not_sendable` and lost. The post to
fulfilment cannot be taken back, so recovery must never risk a second one.

## Alternatives rejected

- A sweep that resets stale rows to `pending` and requeues them. A second
  moving part, and the reset is unconditional unless it re-checks the same
  things; redelivery already arrives with the message in hand.
- Re-claiming without the stamp compare. Two redeliveries, or a slow worker
  and a redelivery, could both win.

## Revisit if

The main queue's visibility timeout changes (`STALE_SEND_CLAIM_MS` mirrors
it), or fulfilment becomes a vendor call with its own idempotency key.
