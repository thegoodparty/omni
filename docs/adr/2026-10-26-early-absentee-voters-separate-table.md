---
title: Early and absentee voters are a separate daily table, filtered by id subquery
status: superseded
decided_by: [hhkarimi]
date: 2026-10-26
code: ['thegoodparty/gp-data-platform#1266', 'thegoodparty/omni#3280']
scope:
  - packages/gp-api/src/peopleDb/databricks/databricksVoterSql.util.ts
  - packages/contracts/src/people/PeopleFilters.schema.ts
superseded_by: 2026-10-26-voted-in-election-includes-l2-early-absentee.md
---

# Early and absentee voters are a separate daily table, filtered by id subquery

## Decision

Whether L2 reports a voter as having already voted early or absentee lives
in its own mart, `mart_gp_api.gp_api_voter_eav_general_2026`, keyed by the
same `id` as the people tables and rebuilt twice daily. The
`earlyAbsenteeVoted` filter reads it per request as `id IN (SELECT id ...)`
for Yes and `id NOT IN (SELECT id ... WHERE id IS NOT NULL)` for No. It is
not a column on `gp_api_voters`.

## Context

`gp_api_voters` is a full rebuild of about 5 hours that runs monthly. Early
and absentee returns change daily in the run-up to the 2026-11-03 General,
and the filter exists so a candidate can leave out people who have already
voted. A column refreshed monthly would be stale for the whole window it is
useful in. The source is a cumulative L2 export uploaded by hand each day.

## Alternatives rejected

- A column on `gp_api_voters`: refreshes monthly, too stale.
- Rebuilding `gp_api_voters` daily: about 5 hours of compute a day for one
  short-lived flag.
- Splitting `gp_api_voters` into a base table plus a view that joins the
  flag: changes the shape every voter read and grant depends on.
- A post-build MERGE into `gp_api_voters`: a second writer on a table dbt
  owns, too invasive for an election-scoped flag.

## Revisit if

The flag outlives this election, or L2 delivers vote history fast enough
that the monthly voter build carries it.
