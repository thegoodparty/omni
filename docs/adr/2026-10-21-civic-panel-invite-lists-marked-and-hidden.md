---
title: Civic panel invite audiences are saved lists marked civicPanelInvite and hidden from the lists index, not deleted
status: superseded
decided_by: [agent]
date: 2026-10-21
code: ['#3080']
scope:
  - packages/gp-api/prisma/schema/voterFileFilter.prisma
  - packages/gp-api/src/contacts/services/civicPanelBuildPlan.service.ts
  - packages/gp-webapp/app/dashboard/contacts/crm/lists/ListsIndex.tsx
supersedes: []
superseded_by: 2026-10-23-managed-panel-invite-lists-marked-and-hidden.md
---

# Civic panel invite audiences are saved lists marked civicPanelInvite and hidden from the lists index, not deleted

## Decision

A list our code saves as a civic panel invite's audience (a build plan
step's draw, the panel's first text, a card with the build purpose) carries
`VoterFileFilter.civicPanelInvite = true`. It stays a saved list, still
returned by `GET /v1/voters/voter-file/filters`, but the webapp's lists
index and the assistant's `crud_saved_filters` list leave it out. The
migration marked existing build-step lists and samples named exactly
"Civic panel invite" on Serve orgs, and deleted nothing.

## Context

Outreach, phone lists and turfs point at their list, the build plan reads a
step's frozen sample members to exclude people from later draws, and the
flows reopen a card's list by finding it in `GET filters`. So the audience
has to stay a list. The panel's one user-facing list is the built-in Civic
panel row, which is never saved.

## Alternatives rejected

- **Stop saving a list.** Every channel's flow and the build plan's
  exclusion read the frozen sample from a saved list.
- **Hide them from `GET filters`.** Breaks the card and step flows that find
  their list there.
- **Infer by name or by the outreach's purpose.** A list an official saved
  and then used for an invite would vanish from their index.

## Revisit if

Saved lists get a general "system list" notion, or invite audiences move
off `VoterFileFilter`.
