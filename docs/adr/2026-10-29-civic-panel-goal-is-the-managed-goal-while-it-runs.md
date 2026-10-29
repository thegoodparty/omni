---
title: The civic panel summary's goal is the managed civic panel's stored goal while it runs
status: active
decided_by: [agent]
date: 2026-10-29
code: ['#PR']
scope:
  - packages/gp-api/src/contacts/services/civicPanelSummary.service.ts
  - packages/gp-webapp/app/dashboard/contacts/citizens-panel/**
supersedes: []
superseded_by:
---

# The civic panel summary's goal is the managed civic panel's stored goal while it runs

## Decision

`GET /v1/contacts/civic-panel` sets `progress.goal` to the managed civic
panel's stored `goalMembers` whenever an enrollment exists that is not
stopped, and to the district's `panelGoalMembers` otherwise. Every screen
that shows a goal (the civic panel page's seats, bar and stage, the
Constituents section, the home card) reads `progress.goal` and never
recomputes it. The live read itself, as recorded in
`2026-10-23-civic-panel-standing-on-the-summary-read.md`, is unchanged.

## Context

The managed civic panel stores its goal at approval and the wave job marks
it ready at that number, but the summary recomputed the district's goal on
every read. When the census read moved (243 against a stored 240), a ready
civic panel showed 240 of 243 and the setup chat and the page named
different goals.

## Alternatives rejected

- Pick the goal in the webapp from the managed read: every reader (page,
  Constituents section, home card) would need both reads and the same rule,
  and they had already drifted once.
- Rewrite the stored goal when the district's moves: the wave job sizes and
  stops waves on the stored goal, so a moving target could re-open a ready
  civic panel.
