---
title: GoodParty builds the civic panel for flagged officials, and the do-it-yourself build plan is deleted
status: active
decided_by: [bryclevgp]
date: 2026-10-22
code: ['#3147']
scope:
  - packages/gp-api/src/contacts/services/managedCivicPanel.service.ts
  - packages/gp-api/src/contacts/services/civicPanelBuildPlan.service.ts
  - packages/gp-api/prisma/schema/managedCivicPanel.prisma
  - packages/gp-api/prisma/schema/civicPanelBuildPlan.prisma
  - packages/contracts/src/people/ManagedCivicPanel.schema.ts
supersedes: []
superseded_by:
---

# GoodParty builds the civic panel for flagged officials, and the do-it-yourself build plan is deleted

## Decision

For officials in `serve-citizen-panels`, GoodParty builds the civic panel for
them. The official approves one invite text once, in the Chief of Staff, in
their own name. A daily job then sends free, texts-only waves of that invite,
steered toward the groups the panel trails, until members reach the
district's goal. State lives in its own model, `ManagedCivicPanel` (one row
per office) with `ManagedPanelWave` (one row per wave), not in
`CivicPanelBuildPlan`. The do-it-yourself build plan (`CivicPanelBuildPlan`,
its steps, routes and Chief of Staff tools) is deleted once the managed
panel ships, in the last PR of the pilot.

## Context

The build plan asks each official for weekly hours and splits the work
across texts they pay for and calls and doors they make themselves. Bryan
approved the managed pilot's plan and designs on 2026-10-22: every wave is
free with no checkout, ops sends each wave by hand from the existing CSV
path, and the panel is ready once members reach the district goal, so the
official's only decision is the approval. The goal stays the district's
`panelGoalMembers`, the same source the plan uses.

## Alternatives rejected

- Extend `CivicPanelBuildPlan` with a managed mode. Its steps, hours, channels
  and statuses are all about the official's own work; a texts-only wave run
  by GoodParty shares almost none of it, and the plan is going away.
- Keep both, letting officials choose. Two ways to build one panel means two
  sets of draws to keep from overlapping and two stories in the Chief of
  Staff, for a pilot whose point is that the official does nothing but
  approve.

## Revisit if

The pilot shows texts alone cannot reach the district goal for some offices,
or the free text cap cannot be sustained past the pilot.
