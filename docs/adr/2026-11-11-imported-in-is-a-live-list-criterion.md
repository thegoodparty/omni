---
title: '"Imported in" is a live criterion on a saved list, never a list per upload'
status: active
decided_by: [swain]
date: 2026-11-11
code: ['#3761']
scope:
  - packages/gp-api/src/contacts/services/contacts.service.ts
  - packages/gp-api/src/shared/schemas/voterFilterBase.schema.ts
  - packages/gp-api/prisma/schema/voterFileFilter.prisma
supersedes: []
superseded_by:
---

# "Imported in" is a live criterion on a saved list, never a list per upload

## Decision

A saved list (`VoterFileFilter`) can name contact uploads in
`contactUploadIds`, next to its demographic criteria. Every read resolves them
to the people those uploads' `contact_upload_match` rows point at, the way an
outreach activity condition is resolved from interaction rows. Several uploads
are OR-ed. Nothing creates a list for an upload: a list exists only when a user
saves one in the builder.

## Context

Users could not find a named import again when picking an audience. Outreach
activity conditions ("texted in campaign X") are the prior art for "this list,
narrowed to people who took part in something": a criterion stored on the
filter and checked live, so it follows the source as it changes. An undone
upload's rows are gone, so a list naming only it holds nobody, never everyone.

## Alternatives rejected

- **Save a list per upload when its file lands.** Clutters every org's lists,
  needs a backfill, and needs undo to delete lists that outreach may use.
- **Frozen member rows, like `geoMembers` and `sampleMembers`.** A snapshot
  goes stale and needs its own lifecycle; the import rows already are the
  membership.
- **A per-upload filter compiled in Databricks.** The overlay view has one row
  per person with no upload id, so it needs a gp-data-platform change first.

## Revisit if

Lists naming many large imports often pass the 200,000-person id-set cap.
