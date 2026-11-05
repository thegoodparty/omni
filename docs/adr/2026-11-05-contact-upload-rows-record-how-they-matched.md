---
title: Contact upload rows record how they were matched in Postgres, not only in analytics
status: active
decided_by: [swain]
date: 2026-11-05
code: ['#3612']
scope:
  - packages/gp-api/prisma/schema/contactUpload.prisma
  - packages/gp-api/src/contactUploads/**
supersedes: []
superseded_by:
---

# Contact upload rows record how they were matched in Postgres, not only in analytics

## Decision

Each `contact_upload_match` row stores how it got its person in two nullable
enum columns. `first_name_match` (exact, alias, prefix, typo) is the winning
candidate's first-name level when the job matched the row to a voter file
person. `resolution` (candidate, search, suggestion, new_person, skip) is how
a user settled the row. `method` stays as it was, so `manual` still marks a
row a user settled and the name-only prior-upload lookup is unchanged. The
analytics events carry the same values, but the columns are the record.

## Context

Nobody could tell whether nickname and prefix matching was doing anything, or
how users settle rows. Postgres is the system of record for imports and
Databricks reads `contact_upload_match` live through federation, so a column
answers both questions in SQL with no event pipeline in between, for every
row ever matched.

## Alternatives rejected

- Events only. Analytics can drop events and is not joinable to the rows in
  the warehouse, so it cannot answer "how was this person matched".
- New `method` values for each first-name level and each resolution. That
  mixes two questions into one column and breaks the code that reads
  `method = manual`.
