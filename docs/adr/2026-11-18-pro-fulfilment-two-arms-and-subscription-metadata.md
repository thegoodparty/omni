---
title: Pro fulfilment has two webhook arms, and the subscription carries its own account link
status: superseded
superseded_by: 2026-11-25-paid-stripe-invoices-grant-pro.md
decided_by: [agent]
date: 2026-11-18
code: ['#3876']
scope:
  - packages/gp-api/src/payments/**
  - packages/gp-api/src/vendors/stripe/**
---

# Pro fulfilment has two webhook arms, and the subscription carries its own account link

## Decision

A Pro subscription is fulfilled by either `checkout.session.completed` or
`customer.subscription.created`, whichever arrives first, and the Pro checkout
stamps `userId` and `campaignId` onto the subscription itself
(`subscription_data.metadata`) so the Stripe object names its account without
the checkout session.

## Context

`campaign.details.subscriptionId` is the only mapping from a live subscription
back to an account, and one webhook wrote it: a missed, delayed or lost
`checkout.session.completed` left a paying account on the free plan with no
retry, no local record of what to retry, and a customer who could only be
released by a human cancelling in Stripe. The 2026-11-17 root-cause analysis
(ENG-11182, ENG-11672) found the class ticket's cases were exactly that shape.

Stripe delivers a subscription's sibling events independently, so the two
events are already a race today; only one of them was allowed to win it. The
`created` event carries the subscription, and the checkout session is a
separate object that Stripe retains for a limited time, so putting the ids on
the subscription is the only way to make the link durable.

## Alternatives rejected

- **Keep one fulfilment path and add a reconcile job.** A pg-boss schedule
  comparing Stripe against the campaign rows heals drift, but only after the
  candidate has been on the free plan for a cycle, and it needs prod Stripe
  credentials on every run. It repairs; it does not prevent.
- **Alert only.** Detection shortens time-to-detect and leaves the manual
  cancellation in place.
- **Backfill metadata onto existing subscriptions.** Not needed to stop
  recurrence (new subscriptions carry it), and it puts a write on every live
  subscription for no entitlement change; the accumulated drift is a data
  repair, tracked separately.
- **Trust the Stripe customer id for fulfilment.** A customer can hold several
  subscriptions and pre-ENG-11084 checkouts minted a customer per session, so a
  customer match does not identify the campaign that was sold.

## Revisit if

Stripe stops delivering `customer.subscription.created`, or the webhook
endpoint's subscribed event list drops it: the second arm is silent without it,
and nothing in CI checks the dashboard's list.
