---
title: Managed panel waves hand off to a swarm agent through OutreachTextHandoff
status: superseded
decided_by: [agent]
date: 2026-11-02
code: ['#3528']
scope:
  - packages/gp-api/prisma/schema/outreach.prisma
  - packages/gp-api/src/outreach/services/outreachTextHandoff.service.ts
  - packages/contracts/src/outreach/OutreachAgentHandoff.schema.ts
supersedes: []
superseded_by: 2026-11-03-the-delegate-swarm-holds-no-gp-api-credential.md
---

# Managed panel waves hand off to a swarm agent through OutreachTextHandoff

## Decision

gp-api owns what the Scale to Win side of a text send should do next. One
`OutreachTextHandoff` row per `Outreach` records the handler (`agent` or
`manual`), the hand-off status, and the vendor campaign the agent built. The
swarm agent lists, claims and reports against gp-api endpoints shaped by
`OutreachAgentHandoff.schema.ts` in contracts; it never decides on its own
what is due. The row hangs off `Outreach`, not `ManagedPanelWave`, so other
Serve texts can use it without a migration.

## Context

`ManagedPanelWave` and `Outreach` say where each wave is, but not where the
vendor console is: whether the list was built, scheduled, or its replies
exported. That lived in people's heads. Automating waves needs that state
somewhere both gp-api and the agent can read.

This does not reverse `2026-10-22-managed-panel-wave-job-derives-each-step`.
The table is vendor state, a fact about another system that the wave rows
cannot derive, not a job-run log of what the daily job meant to do. The job
still derives each step from the wave and send rows.

## Alternatives rejected

- **Columns on `ManagedPanelWave`.** Ties the hand-off to managed panels and
  would need a migration for each new kind of Serve text.
- **The agent keeps its own state.** A second source of truth that can
  disagree with gp-api, and a lost agent run would lose the schedule.
- **A job-run table.** Records intent, not vendor reality, and is the shape
  the 2026-10-22 decision rejected.
