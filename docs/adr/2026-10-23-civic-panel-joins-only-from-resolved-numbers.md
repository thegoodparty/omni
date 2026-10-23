---
title: A texted civic panel JOIN counts only from a number the send or the voter file resolves
status: active
decided_by: [bryclevgp]
date: 2026-10-23
code: ['#3172']
scope:
  - packages/gp-api/src/outreach/services/outreachTextIngest.service.ts
  - packages/gp-api/prisma/schema/managedCivicPanel.prisma
supersedes: [2026-10-23-civic-panel-joiners-outside-the-voter-file.md]
superseded_by:
---

# A texted civic panel JOIN counts only from a number the send or the voter file resolves

## Decision

Residents join a civic panel only by replying JOIN to a send that asks. The
reply ingest resolves the reply phone to a send recipient, or to a voter-file
person by phone, and writes `civic_panel = member` for that `personId`
through `ContactStatusService.changeStatus`. A JOIN from a number neither
holds is dropped, like any other unmatched reply. There is no public join
page and no table of joiners outside the voter file.

## Context

The public join page and the joiner rows behind it were out of scope for the
managed civic panel. The page took any phone number with no verification, so
anyone could put someone else's number on a panel. Every member count, draw
and saved panel list is keyed by voter-file `personId`, so members the voter
file does not hold needed a second identity path nothing else uses.

## Alternatives rejected

- **Keep joiners outside the voter file for texted JOINs only.** Still a
  second identity path and table for a case the product does not need; a
  forwarded invite from a voter-file number still joins.
- **Keep the page with phone verification.** Not wanted: joining is by text.

## Revisit if

The product decides residents outside the voter file should join a panel.
