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
are OR-ed. Outreach stays tied to a saved list, like every other channel: no
send stores import ids of its own. Nothing creates a list when an upload lands.
A list exists when a user saves one in the builder, or picks an import in the
email audience picker, which reuses the list whose only criterion is that
import or saves one under its name, the way the "Everyone with an email" row
does today.

## Context

Users could not find a named import again when picking an audience. Outreach
activity conditions ("texted in campaign X") are the prior art for "this list,
narrowed to people who took part in something": a criterion stored on the
filter and checked live, so it follows the source as it changes. An undone
upload's rows are gone, so a list naming only it holds nobody, never everyone.

## Alternatives rejected

- **The email send stores the picked imports instead of a list.** Email would
  be the one channel whose audience is not a list, so drafts, confirm, the
  recipient resolve and activity conditions would each need a second branch.
- **Save a list per upload when its file lands.** Clutters every org's lists,
  needs a backfill, and needs undo to delete lists that outreach may use.
- **Frozen member rows, like `geoMembers` and `sampleMembers`.** A snapshot
  goes stale and needs its own lifecycle; the import rows already are the
  membership.
- **A per-upload filter compiled in Databricks.** The overlay view has one row
  per person with no upload id, so it needs a gp-data-platform change first.

## Revisit if

Lists naming many large imports often pass the 200,000-person id-set cap.
