---
title: Managed civic panel wave lists are saved lists marked civicPanelInvite and hidden from the lists index
status: active
decided_by: [agent]
date: 2026-10-23
code: ['#3175']
scope:
  - packages/gp-api/prisma/schema/voterFileFilter.prisma
  - packages/gp-api/src/contacts/services/managedPanelWaveDraw.service.ts
  - packages/gp-webapp/app/dashboard/contacts/crm/lists/ListsIndex.tsx
supersedes:
  - 2026-10-21-civic-panel-invite-lists-marked-and-hidden.md
superseded_by:
---

# Managed civic panel wave lists are saved lists marked civicPanelInvite and hidden from the lists index

## Decision

The list a managed civic panel wave draws carries
`VoterFileFilter.civicPanelInvite = true`. It stays a saved list, still
returned by `GET /v1/voters/voter-file/filters`, but the webapp's lists
index and the assistant's `crud_saved_filters` leave it out. Lists the
deleted build plan saved keep the flag and stay hidden.

## Context

The earlier record made the same rule for the build plan's step lists. The
plan is deleted; the rule now holds for the managed panel's waves, whose
send and later draws read the wave's frozen sample from its saved list. The
panel's one user-facing list is the built-in Civic panel row, which is
never saved.

## Alternatives rejected

- **Stop saving a list.** The wave's send and the exclusion of earlier
  waves' people read the frozen sample from a saved list.
- **Hide them from `GET filters`.** Breaks the flows that find a list there.
- **Infer by name.** A list an official saved under the same name would
  vanish from their index.

## Revisit if

Saved lists get a general "system list" notion, or wave audiences move off
`VoterFileFilter`.
