---
title: The managed panel wave job derives each step from the rows, and makes its own unpaid draft
status: active
decided_by: [agent]
date: 2026-10-22
code: ['#PR']
scope:
  - packages/gp-api/src/managedPanelWaves/**
  - packages/gp-api/prisma/schema/managedCivicPanel.prisma
  - packages/contracts/src/people/ManagedCivicPanel.schema.ts
supersedes: []
superseded_by:
---

# The managed panel wave job derives each step from the rows, and makes its own unpaid draft

## Decision

The daily job keeps no record of what it meant to do. Each run reads the
enrollment, its open wave and that wave's send, and takes the one step they
call for: send an unsent wave, wait, close a wave past its reply window, draw
the next, or finish the panel. A wave is open until `closedAt`; `exhausted`
is a panel status beside `ready`. The job writes the wave's send itself, as
an unpaid Serve text draft linked by the unique `managedPanelWaveId`, and
`claimFree` stays the only thing that makes it free.

## Context

A free send is a claim, an enqueue and a wave update, and any of them can die
between runs. `claimFree` already resumes a claim left `pending`; the job
needed to finish every other half-done state without making a second wave or
a second send. Sends reach staff by hand, so a retry that double-sends is
worse than one that waits a day.

## Alternatives rejected

- **A job-run table recording each step.** A second source of truth that can
  disagree with the rows it describes; the rows already say where each wave
  is.
- **Calling the draft route's `createDraft`.** It refuses lists under 25
  people (a checkout floor a free send has no use for), and it cannot write
  `managedPanelWaveId` in the same insert, so a crash would leave an unlinked
  draft and a retry a second one.
- **An `exhaustedAt` timestamp on a still-`building` panel.** Every reader of
  `status` would have to know to look at it, and the panel would read as
  building forever.
- **Closing a wave implicitly when `replyWindowEndsAt` passes.** Nothing
  would hold the members a wave brought in, and "is a wave open" would be a
  date comparison repeated in every reader.

## Revisit if

Keep-fresh re-draws replace members who drop off: the job then needs to tell
a refill wave from a build wave.
