---
title: One channel-neutral payment-hold system for outreach; email first, robocall intended to follow
status: active
decided_by: [stephtea]
date: 2026-10-27
code: ['#3294']
scope:
  - packages/gp-api/src/paymentHolds/**
supersedes: []
superseded_by:
---

# One channel-neutral payment-hold system for outreach; email first, robocall intended to follow

## Decision

Outreach channels that bill after the send pay through one shared hold system
in `src/paymentHolds/`: save the card at confirm, authorize 3 days before the
send (or at once when it is sooner), capture only what the channel reports it
sent, and release on a cancel. A channel never talks to Stripe for its send.
It calls `PaymentHoldsApi` and registers one `SettlementAdapter`
(`stopAndReport`), which `settle` calls under the `capturing` claim. Email is
the first channel. Robocall is intended to move onto it; that has a ticket but
no owner or date, so for now this is the third hold implementation.

## Context

Email sends are routinely smaller than estimated (suppressions, the warming
cap, auto-pause, cancels) and can be scheduled up to 30 days out. Charging up
front means a partial refund on most sends; a Checkout hold at confirm cannot
cover a send more than a few days away. GoodParty already had two hold
implementations, each tied to its channel: robocall's deferred saved-card
holds and the Win SMS Checkout hold. Design: ClickUp doc `2ky4jq2q-20493`,
page "Outreach payment holds (shared)" (`2ky4jq2q-157473`).

## Alternatives rejected

- **Charge up front with Checkout, like SMS.** A refund on most sends: slow
  for the user, fees we don't get back, and a charge then a refund on their
  statement.
- **Copy robocall's hold code into email.** A third channel-specific copy,
  with its claim, recovery and reconcile logic to keep in step with the other
  two.
- **Extend robocall's hold service to take email.** Its states and columns
  are robocall's run lifecycle (`RobocallSettleState`, the CallHub fields),
  not a hold's.

## Revisit if

Robocall's migration is dropped for good, or a channel needs to charge
before it sends.
