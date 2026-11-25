---
title: Paid Stripe invoices grant Pro on the campaign selected at checkout
status: active
decided_by: [swain]
date: 2026-11-25
scope:
  - packages/gp-api/src/payments/**
  - packages/gp-api/src/vendors/stripe/**
supersedes:
  - 2026-11-18-pro-fulfilment-two-arms-and-subscription-metadata.md
---

# Paid Stripe invoices grant Pro on the campaign selected at checkout

## Decision

`invoice.paid` is the trigger for subscription-backed Pro, at purchase and
renewal. Verify the subscription is active and is for our Pro product. Checkout
stamps the user and campaign IDs on both the session and its subscription. A
paid invoice uses that exact campaign after verifying its owner. An older
subscription without campaign metadata can use a unique existing link, but not
an inferred match by email, customer ID, or currently active campaign.

Store the Stripe subscription ID, Pro entitlement, and plan state in the same
transaction. Stripe billing is outside that transaction. Replayed deliveries
must not grant benefits or run first-upgrade effects twice. Other sources of
paid plans and staff grants stay independent.

## Context

Checkout and subscription lifecycle notifications do not prove that payment is
settled. Their handlers also used to resolve the campaign again at delivery
time and commit the subscription link separately from the Pro grant.

Keep legacy grant handlers as a compatibility fallback until both Stripe
environments deliver `invoice.paid` successfully. Enable invoice-only grants
per stack after verifying an initial invoice and a renewal. See
`packages/gp-api/src/payments/AGENTS.md` for the cutover.

## Alternatives rejected

- Link to the buyer’s active campaign when the webhook arrives. A different
  campaign may be active by then, and a user can own more than one campaign.
- Grant from `customer.subscription.updated` as a renewal repair. That event
  also fires for edits unrelated to payment and does not prove an invoice was
  paid.
