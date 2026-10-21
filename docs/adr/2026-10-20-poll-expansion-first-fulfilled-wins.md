---
title: A poll expansion is keyed on its checkout id; a concurrent second checkout is refunded
status: active
decided_by: [agent]
date: 2026-10-20
code: ['#PR']
scope:
  - packages/gp-api/src/polls/services/pollPurchase.service.ts
  - packages/gp-api/src/polls/services/polls.service.ts
  - packages/gp-api/prisma/schema/poll.prisma
supersedes: []
superseded_by:
---

# A poll expansion is keyed on its checkout id; a concurrent second checkout is refunded

## Decision

`Poll.expansionCheckoutSessionId` records the checkout that paid for the
poll's latest expansion, written in the same optimistic update as the
expansion. A fulfillment that finds its own checkout id there is a no-op. A
paid checkout that finds any other id gets a full Stripe refund, keyed on the
checkout so racing callers refund once. `validatePurchase` refuses, before
payment, an expansion of a poll that is not `COMPLETED` or not the buyer's.

## Context

The browser and Stripe's `checkout.session.completed` webhook both fulfill
every checkout, and `completeCheckoutSession` stamps its marker only after the
handler returns, so both ran `expandPoll`. The loser got
`BadRequestException('Poll is not completed')`, which the webhook logged as a
permanent rejection. Separately, checkout creation only checked the metadata
schema, so a buyer could pay for an expansion fulfillment would refuse. The
checkout gate closes that except when two checkouts are opened while the poll
is `COMPLETED` (two tabs): both pass, and a poll takes one expansion at a time.

## Alternatives rejected

- **One payable checkout per poll, Pro style** (store the session id at
  creation, expire the previous one): prevents the second charge outright, but
  needs a new post-creation hook on the `PurchaseHandler` interface, which
  `PurchaseService` already marks for removal, for a race that needs two open
  tabs on a legacy type.
- **Stack the second expansion onto the first**: the `POLL_EXPANSION`
  consumer samples `targetAudienceSize` minus messages already sent, so adding
  to an expansion in flight can text the same batch size twice.
- **A `PollExpansion` table unique on the checkout id**: survives a later
  expansion overwriting the id, but only a redelivery days after a failed
  marker stamp would need that.
- **Log and refund by hand**: the buyer stays charged for nothing until
  someone reads the log.

## Revisit if

The legacy `POLL` type is retired in favour of the Serve `SERVE_TEXT` poll
flow, at which point this record should be deleted with it.
