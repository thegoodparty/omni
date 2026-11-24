---
title: API-built panel waves keep their progress on OutreachTextHandoff
status: active
decided_by: [tomer-tgp]
date: 2026-11-23
code: ['#4030']
scope:
  - packages/gp-api/prisma/schema/outreach.prisma
  - packages/gp-api/src/managedPanelWaves/managedPanelWaveJob.service.ts
  - packages/gp-api/src/outreach/services/outreachTextDelivery.service.ts
supersedes: []
superseded_by:
---

# API-built panel waves keep their progress on OutreachTextHandoff

## Decision

A panel wave that gp-api builds through the Scale to Win Text API is an
`OutreachTextHandoff` row with `handler: api`. Its progress is a forward-only
`apiStep` enum plus nullable columns (`apiCampaignId`, `recipientCsvKey`,
`recipientCount`, `loadedCount`, `loadSkips`, `sentAt` and the like) on that
row; agent and manual rows leave them null. The handler is chosen once from the
`serve-panel-wave-agent` variant (`api_shadow`, `api_auto`) and frozen on the
row with `mode`, so a flag flip only affects new hand-offs.

## Context

The row already holds the vendor-side state of a wave: the overdue alarm, the
reply export and the Slack hand-off all read it. Moving the build from the
browser runner into gp-api changes who does the work, not what state exists.

## Alternatives rejected

- **A new `S2wApiWave` table.** Splits one wave's vendor state across two
  tables, and every reader of the hand-off row would need to join both.
- **Inferring the handler later** (from the campaign id, or from the flag at
  sweep time). A flag change mid-wave would move a half-built wave between
  paths.

## Revisit if

Another vendor or a second API-driven Serve text needs its own step machine;
then the step columns belong in a per-vendor table.
