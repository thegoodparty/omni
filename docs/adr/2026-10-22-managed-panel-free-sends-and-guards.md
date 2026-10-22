---
title: Only a managed civic panel wave may skip payment, through one internal claim and a second gate at send
status: active
decided_by: [bryclevgp]
date: 2026-10-22
code: ['#PR_NUMBER']
scope:
  - packages/gp-api/src/managedWaveFunding/**
  - packages/gp-api/src/outreach/services/outreachTextSendFunding.service.ts
  - packages/gp-api/src/outreach/services/outreachTextDelivery.service.ts
  - packages/gp-api/src/outreach/services/managedPanelFundingReconcile.service.ts
  - packages/gp-api/src/queue/consumer/queueConsumer.service.ts
  - packages/gp-api/prisma/schema/outreach.prisma
  - packages/gp-api/prisma/schema/managedCivicPanel.prisma
supersedes: []
superseded_by:
---

# Only a managed civic panel wave may skip payment, through one internal claim and a second gate at send

## Decision

A Serve text goes out without a Stripe checkout only when it is a managed
civic panel wave. `Outreach.fundedBy` (null means paid, `goodparty_pilot`
means free) is written by `ManagedWaveFundingService.claimFree` alone: no
route, no client field, an import test that fails if anything a request
reaches imports it, and every condition checked inside one transaction. A
database CHECK allows `fundedBy` only on a row linked to a wave
(`Outreach.managedPanelWaveId`, unique) and never beside a checkout session.
The text delivery layer independently refuses any send that is neither paid
nor a live wave, a daily job reconciles every unpaid send, and both raise a
metric-backed Grafana alarm. `serve-citizen-panels`, read for the official
who approved the panel, is the only switch: both the claim and the send-time
gate refuse anything of theirs once it is off.

## Context

The managed pilot (`2026-10-22-managed-civic-panel-replaces-build-plan.md`)
sends waves for free. It is peak election season, and the cost of a bug that
lets any other send skip payment is texts nobody paid for, at scale. Until
now `pending` meant paid because only the purchase claim could write it, so
the delivery layer never looked at payment. The wave-to-send link moved from
`ManagedPanelWave.outreachId` to `Outreach.managedPanelWaveId` so the CHECK
can see the link and the funding on one row; no wave had ever been written.

## Alternatives rejected

- A free SERVE_TEXT purchase at zero amount through `complete-free-purchase`.
  That route is client-reachable, so a free send would be one request away
  from every official.
- Trusting the claim alone. A later bug that writes `pending` some other way
  would go out unpaid with nothing to notice; the send-time gate and the
  reconciliation are what catch it.
- A database trigger instead of the CHECK and link move. Harder to read and
  to test than a column constraint on one row.
- A separate env-var kill switch beside the flag. Two controls for one
  rollout invites them to disagree; turning the flag off for an office stops
  its free sends at both the claim and the send.

## Revisit if

The pilot ends or becomes a paid product, or a second kind of free send is
needed; either should extend `OutreachFunding` and the gate together.
