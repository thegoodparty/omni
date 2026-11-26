---
title: Resident comments are read live from Databricks, from a table named in config, and never fail the welcome
status: active
decided_by: [agent]
date: 2026-11-25
code: ['#4066']
scope:
  - packages/gp-api/src/residentVoices/**
  - packages/gp-api/src/peopleDb/databricks/residentVoicesSql.util.ts
  - packages/gp-api/src/peopleDb/services/residentVoiceQuery.service.ts
  - packages/contracts/src/residentVoices/**
supersedes: []
superseded_by:
---

# Resident comments are read live from Databricks, from a table named in config, and never fail the welcome

## Decision

`GET /v1/resident-voices` reads the office's district's rows from the data
team's resident comments table on each request, through the people
Databricks identity (`PeopleDbxStatementClient`), and picks the six to show
in gp-api. The table's `catalog.schema.table` name is the
`RESIDENT_VOICES_TABLE` variable, defaulting to
`goodparty_data_catalog.sandbox.pro_district_resident_voices`. The table's
`district_id` is the election database's district id, so no crosswalk is
kept. Any failure, and a read slower than about four seconds, answers
`{ voices: [], syntheticCount: 0 }` with a warning, and the welcome goes on
without its map. Nothing about a comment but its words, a fuzzed point and
whether it is synthesized leaves gp-api.

## Context

The Serve welcome shows a map of what residents have said. The comments
exist only in a sandbox table that the data team will move, and the
identity gp-api reads the warehouse with has no access to that schema
(checked 2026-11-25: `gp_api` lacks `USE SCHEMA` on `sandbox`). The map is
one optional screen of a flow a winner sees once, so it must not be able to
block that flow. The table is small (under 8,000 rows, 25 at most for a
district) and gp-api already reads the warehouse live for every people read.

## Alternatives rejected

- **Copy the table into gp-api's Postgres.** A second pipeline and a schema
  to keep in step with a table whose shape and home are still moving, for
  one screen. The product brief also forbids copying its rows into the repo.
- **A table name fixed in code.** The move out of the sandbox would then
  need a gp-api release timed with the data team's.
- **Let a failed read fail the request.** The webapp would have to tell a
  missing table from a broken welcome. An empty list already means "skip".
- **Send every row and pick in the browser.** Source, tier and location
  status would cross to the client, and the brief says no card may show them.

## Revisit if

The comments are shown anywhere a visit repeats (a Serve home card, a page):
a read per view would then want a cache or a mart keyed for it.
