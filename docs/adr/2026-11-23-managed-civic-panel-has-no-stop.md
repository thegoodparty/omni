---
title: A managed civic panel has no stop; a stopped one with a sent wave is paused
status: active
decided_by: [bryclevgp]
date: 2026-11-23
code: ['#4003']
scope:
  - packages/contracts/src/people/ManagedCivicPanel.schema.ts
  - packages/gp-api/src/contacts/services/managedCivicPanel.service.ts
  - packages/gp-api/prisma/schema/migrations/20261123120000_pause_stopped_managed_panels_with_sent_waves/**
---

# A managed civic panel has no stop; a stopped one with a sent wave is paused

## Decision

`PATCH /v1/contacts/civic-panel/managed` takes only `pause` and `resume`.
`stop` is gone from the contract and the route 400s it. A one-time migration
moves every stopped panel that already sent a wave to `paused`, keeping
`stopped_at` as its `paused_at`, so the official can resume it. A stopped
panel that never sent a wave stays stopped and is offered again as before,
and so does one with a free wave or confirmation text still `pending`: the
funding gate refuses free sends only for stopped panels, so pausing it would
let that text go out.

## Context

The webapp stopped sending `stop` on 2026-10-27, but the route kept it. A
panel stopped that way loses everything the official sees: the home offers
"Build my civic panel" as if nothing had been built, the civic panel page
has no Invites card and so no Resume, and the only way back is approving
the invite again. An official who asked GoodParty to hold her invites after
the first wave was left looking at a fresh offer with her wave one members
out of view. Pause already holds invites and keeps the panel resumable, so
it covers every reason to stop.

## Alternatives rejected

- **Keep `stop` and treat a stopped panel with history as paused in every
  reader** (home cards, civic panel page, chat tools, resume). Every reader
  of `status` would need the same exception, and a stopped panel would still
  be one more state that means paused.
- **Keep `stop` only for staff.** No staff tool uses it, and holding a
  panel for an official is a pause.
