---
title: Import contacts covers Win campaigns behind the same flag, Pro only
status: active
decided_by: [swain]
date: 2026-10-29
code: ['#3429']
scope:
  - packages/gp-api/src/contactUploads/**
  - packages/gp-api/src/peopleDb/services/peopleDataset.service.ts
  - packages/gp-api/src/contactEngagement/contactEngagement.service.ts
supersedes: []
superseded_by:
---

# Import contacts covers Win campaigns behind the same flag, Pro only

## Decision

Import contacts works for Win (candidate) campaigns as well as Serve offices.
Both sit behind the one `serve-import-contacts` flag, evaluated for the org's
owner (`ORGANIZATION_FLAGS`); the name stays. A Win campaign also needs Pro,
the same rule as opening a contact's details (`ContactsService` pro access),
and a campaign without it gets that 403. Serve is unchanged.

Every org with the flag on reads through its contact overlay
(`2026-10-29-people-reads-join-the-contact-overlay-at-read-time.md`, written
for Serve and now covering Win too). For a Win campaign the base table stays
`gp_api_voters` and the overlay's district is the campaign's district,
resolved the way its contacts reads resolve it. An
imported person a Win campaign added gets an id the way
`2026-10-29-imported-people-get-gp-api-minted-person-ids.md` describes, and
reads NULL, so unknown, in every voter-only column (party, turnout, voter
status, early vote).

## Context

Candidates hold the same kind of lists officials do: event sign-ups,
volunteers, donors who never matched the voter file. The upload, matching,
review and overlay read were built org-agnostic apart from `eo-` checks at
the routes, the dataset choice and the activity feed, so opening Win meant
removing those checks, not building a second path.

## Alternatives rejected

- **A separate Win flag.** Two flags for one feature, which could drift
  apart in rollout while the code path is the same.
- **Win for every tier.** Imported contacts are read as person records, which
  Win already reserves for Pro.

## Revisit if

Win and Serve need to roll out separately, or Pro stops being the gate for
person records.
