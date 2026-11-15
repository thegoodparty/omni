---
title: A managed civic panel wave, and a full panel's one confirmation text, are the only sends that may skip payment
status: active
decided_by: [bryclevgp]
date: 2026-11-10
code: ['#3719']
scope:
  - packages/gp-api/src/managedWaveFunding/**
  - packages/gp-api/src/outreach/services/outreachTextSendFunding.service.ts
  - packages/gp-api/src/outreach/services/outreachTextDelivery.service.ts
  - packages/gp-api/src/outreach/services/managedPanelFundingReconcile.service.ts
  - packages/gp-api/src/queue/consumer/queueConsumer.service.ts
  - packages/gp-api/prisma/schema/outreach.prisma
  - packages/gp-api/prisma/schema/managedCivicPanel.prisma
supersedes: [2026-10-22-managed-panel-free-sends-and-guards.md]
superseded_by:
---

# A managed civic panel wave, and a full panel's one confirmation text, are the only sends that may skip payment

## Decision

Everything the superseded record set up still holds for waves: one internal
claim, a database CHECK, a second gate at send, a daily reconcile, and
`serve-citizen-panels` for the approving official as the only switch. A
second free send joins it, through the same four guards rather than around
them. `OutreachFunding.goodparty_panel_confirmation` marks the one thank-you
text a managed panel's members get once it is full. It is set only by
`ManagedWaveFundingService.claimConfirmationFree`, on a send linked to its
panel by the unique `Outreach.managedPanelConfirmationForId`, only while the
panel is `ready`, only on a text with the opt-out and no JOIN line, and
without counting against `freeTextCap`. The CHECK now requires each free
funding to name its own link; the delivery gate and the reconcile accept a
confirmation of its own org's panel that is not stopped.

## Context

Residents who reply JOIN hear nothing until the panel is full, and some forget
why they joined. Manual fulfilment rules out an instant reply on joining, so
the panel thanks its members once, when it fills. That send is not a wave and
cannot be paid for by the official, and the superseded record's own "revisit
if" said a second free send should extend `OutreachFunding` and the gate
together.

## Alternatives rejected

- **Making the confirmation a special wave.** Every wave step (drawing, reply
  windows, upload waits, stall alerts, closing) would have to learn to skip
  it, and the next change to any of them could send or close it by mistake.
- **Counting it against the free-text cap.** Its recipients are members the
  waves already paid to reach, and a panel at its cap would never thank them.
- **Checking its exact words in the claim.** The official never approved this
  text; GoodParty wrote it in their name. The claim instead refuses anything
  that asks people to join or lacks the opt-out.

## Revisit if

The pilot ends or becomes paid, or a third kind of free send is needed.
