---
title: An office's first focus is a timestamp on the priority, and what the official was shown is its own two tables
status: active
decided_by: [agent]
date: 2026-11-25
code: ['#4066']
scope:
  - packages/gp-api/src/priorities/services/priorityFocus.service.ts
  - packages/gp-api/prisma/schema/priority.prisma
  - packages/gp-api/prisma/schema/priorityFocusChoice.prisma
  - packages/gp-api/prisma/schema/priorityFocusOption.prisma
  - packages/contracts/src/priorities/PriorityFocus.schema.ts
supersedes: []
superseded_by:
---

# An office's first focus is a timestamp on the priority, and what the official was shown is its own two tables

## Decision

The welcome's one pick is stored in two places that answer two questions.

- **Which priority is the focus now:** `Priority.focusedAt`. At most one live
  row per office carries it, and `PrioritiesService.listActive` returns that
  row first.
- **What happened on the Priorities step:** one `PriorityFocusChoice` per
  office (the picked priority, when, and whether the save made that priority
  live) and one `PriorityFocusOption` per card shown (key, kind, title, both
  facts as shown, where each fact came from, picked or not). Other modules
  read it through `PriorityFocusService.savedFor`.

Saving again rewrites the choice. A priority the earlier save made live
(created from a community issue, or brought back from the archive) is
archived again when it is no longer the pick. Nothing else is touched. Once a
choice exists, `GET /v1/priorities/onboarding/focus` returns the cards that
were shown, not a fresh list.

Olly Farshi decided on 2026-11-25 that the pick becomes the first focus,
that nothing not picked changes, and that what was shown is kept for a later
Serve feature. The shape is the agent's.

## Context

`PriorityOnboardingService.set` received `shownKeys` and `selectedKeys` and
kept neither. No field marked one priority as the focus, and the list was
ordered by creation date. No screen reads the saved choice yet.

## Alternatives rejected

- **A pointer on the office (`ElectedOffice.focusPriorityId`).** One more
  relation on a table most modules load, and the list would need a second
  read to order by it.
- **A JSON column for the cards shown.** The shape is known, and a later
  feature will filter on kind and on picked. `prisma/AGENTS.md` rules JSON
  out for known shapes.
- **One row per save, kept as history.** Nothing asks for the history, and a
  reader would have to pick the latest every time.
- **Only `focusedAt`, no saved choice.** It cannot say which cards were
  passed over, which is what the later feature needs.
- **Rebuild the cards on every read.** A full run can re-rank the community
  list between the pick and a tap on Back, and the saved pick could drop off
  the screen.

## Revisit if

A Serve feature lets the official move their focus after onboarding. Then
`focusedAt` moves without a choice row, and the two must be kept apart.
