---
title: A civic panel joiner the voter file does not hold gets their own id as personId, through the one member write
status: active
decided_by: [agent]
date: 2026-10-23
code: ['#TBD']
scope:
  - packages/gp-api/src/contacts/services/civicPanelJoin.service.ts
  - packages/gp-api/src/outreach/services/outreachTextIngest.service.ts
  - packages/gp-api/prisma/schema/managedCivicPanel.prisma
supersedes: []
superseded_by:
---

# A civic panel joiner the voter file does not hold gets their own id as personId, through the one member write

## Decision

Joining from the public join page, or by texting JOIN from a number no send
recipient or voter holds, records a `CivicPanelJoiner` row keyed by
(office, 10-digit phone). Its `personId` is the voter-file person the phone
matched, or the row's own uuid when it matched nobody. Membership is then the
same `civic_panel = member` status every other way onto the panel writes,
through `ContactStatusService.changeStatus`. The ingest looks reply phones up
among joiners before the People DB, so a joiner's later STOP or LEAVE reaches
them.

## Context

The brief: an unmatched joiner still joins, and a JOIN to a wave and a join
from the page must never count one person twice. Members are counted, drawn
against and steered from the `civic_panel` status set (the wave job, the
summary, the managed panel's progress, saved panel lists), all keyed by
`personId`, and the voter id filter only takes uuids.

## Alternatives rejected

- **Counting unmatched joiners beside the status set.** Every member count
  (summary, progress, the wave job's goal, wave `joinedMembers`) would have to
  add a second source, and a STOP or LEAVE would need its own path.
- **A synthetic id that is not a uuid** (`joiner:<id>`). The voter id filter
  rejects non-uuids, so a saved panel list would fail to resolve.
- **Dropping unmatched joiners**, as the ingest did for unmatched replies.
  Contradicts the brief, and loses people who asked to be heard.

## Revisit if

The voter file gains a way to hold people it does not cover, or panel lists
need to text joiners outside it: they are on no voter-file list today.
