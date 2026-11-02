---
title: Voted in election ORs L2's early and absentee table with campaign-recorded voters
status: active
decided_by: [hhkarimi]
date: 2026-10-26
code: ['thegoodparty/gp-data-platform#1266', 'thegoodparty/omni#3280', 'thegoodparty/omni#3284']
scope:
  - packages/gp-api/src/peopleDb/databricks/databricksVoterSql.util.ts
  - packages/gp-api/src/contacts/services/contacts.service.ts
  - packages/contracts/src/people/PeopleFilters.schema.ts
supersedes: [2026-10-26-early-absentee-voters-separate-table.md]
---

# Voted in election ORs L2's early and absentee table with campaign-recorded voters

## Decision

There is one "Voted in election" filter (`votedStatus`), labelled Yes and
No/Unknown. Yes is anyone in `mart_gp_api.gp_api_voter_eav_general_2026`
(L2's early and absentee voters, rebuilt twice daily) OR anyone whose latest
will-vote answer to this org's knocks and calls is already voted. No/Unknown
is neither. `ContactsService.resolveBaseFilters` resolves the campaign half
in Postgres and sends both halves as `votedInElection` plus its sibling
`votedInElectionReportedIds`, which the SQL builder joins in one clause:
`(id IN (SELECT id FROM <eav>) OR id IN (<ids>))` for Yes, and the null-safe
`NOT IN` of both for No. The L2 table stays separate from `gp_api_voters`.
Recommended lists use No/Unknown (`NOT_YET_VOTED`), so they drop L2 voters
too.

## Context

The previous record made L2's list its own pill beside "Voted in election".
Two pills for one question meant a candidate had to know to pick both. The
`id` resolution every other Postgres-derived criterion uses can only
intersect, and Yes needs a union with a Databricks table, so the campaign
half rides as a filter key instead. The table stays separate for the same
reason as before: `gp_api_voters` is a monthly rebuild of about 5 hours, and
early returns change daily before the 2026-11-03 General.

## Alternatives rejected

- Keeping two pills: the same question asked twice, with different answers
  for people only one source knows about.
- A column on `gp_api_voters`, a daily rebuild of it, a base-table-plus-view
  split, or a post-build MERGE: rejected in the superseded record, for the
  same reasons.
- Threading the campaign ids as a separate override alongside
  `contactsMadeIdOverrides`: the same result through every people-db call
  signature, for a short-lived election flag.

## Revisit if

The flag outlives this election, or L2 delivers vote history fast enough
that the monthly voter build carries it.
