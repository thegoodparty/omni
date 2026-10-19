---
title: A priority's round 2 text is marked by its list being an undrawn sample, not by an Outreach column
status: active
decided_by: [agent]
date: 2026-10-19
code: []
scope:
  - packages/gp-api/src/priorities/services/priorityRoundTwoDraw.service.ts
  - packages/gp-api/src/priorities/util/roundTwo.util.ts
  - packages/gp-api/src/outreach/services/outreachServeSmsCreate.service.ts
  - packages/gp-api/src/outreach/services/outreachServeSmsPurchase.service.ts
supersedes: []
superseded_by:
---

# A priority's round 2 text is marked by its list being an undrawn sample, not by an Outreach column

## Decision

A round 2 send is an ordinary Serve text whose `voterFileFilterId` points at
a copy of the pool list saved with `sampleSize` set and `sampledAt` null.
That state means "round 2, not drawn yet": the purchase handler holds it,
the consumer refuses it, and the draw job finds it. The draw claims it by
stamping `sampledAt` (a CAS on null) and writes the members; a failure
before the enqueue clears it again. No migration.

## Context

The request was to avoid a schema change if existing fields could carry
round 2 correctly. Every other sampled list is drawn when it is saved
(`VoterFileFilterService.create` writes `sampleSize` and `sampledAt`
together), so the undrawn state is new and unambiguous. A sample list
resolves through its members, keyed on `sampleSize`, so an undrawn one
reaches nobody: a send that slipped through early texts no one rather than
the whole pool. The draw needs the pool's criteria, and copying the list
keeps them on the send without a pointer back to the official's own list.

## Alternatives rejected

- **`Outreach.priorityRound` and `Outreach.recipientsDrawnAt`.** Explicit,
  but a migration for facts the list already holds.
- **A new `priorityCheckSide` value.** That column is the check's side,
  and the round 2 text needs its real side for `recordOutreachSent`.
- **Mark the pool list itself as the sample.** Changes a list the official
  saved and may reuse for other sends.

## Revisit if

Another path starts saving sample lists to draw later, or round 2 needs a
state the list cannot hold (a second draw, a draw the official approves).
