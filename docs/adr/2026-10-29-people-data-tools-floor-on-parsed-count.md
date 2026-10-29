---
title: People-data chat tools share one validator and floor every row on its parsed COUNT(*)
status: active
decided_by: [agent]
date: 2026-10-29
code: ['#3415']
scope:
  - packages/gp-api/src/llm/tools/constituentSql.validator.ts
  - packages/gp-api/src/llm/tools/districtInsights.tool.ts
  - packages/gp-api/src/llm/tools/queryConstituentData.tool.ts
  - packages/gp-api/src/chats/briefing-chats/briefingAnnotation.handler.ts
supersedes: []
superseded_by:
---

# People-data chat tools share one validator and floor every row on its parsed COUNT(\*)

## Decision

Every chat tool that runs model-written SQL against the Serve agent mart
(`query_constituent_data`, `district_insights`) validates it with
`validateConstituentSql` in `constituentSql.validator.ts`, against the
column allowlist `buildConstituentDataScope` builds. A query must select
a bare, unfiltered `COUNT(*)`. `scrubResults` drops every row whose
`COUNT(*)` is below the floor, finding that column from the parsed SQL
(`findRowCountColumn`) and never from an alias match. No other select
item may share its name. Every other count-like value is masked below
the floor whatever its alias.

## Context

`district_insights` ran only the base validator, and both tools picked
the row-count column by alias. A query with no count column returned one
row per voter, and a `MAX(... * 1000) AS count` could stand in for the
count. Model-written SQL is reachable by prompt injection, so the floor
has to hold for any query the validator accepts.

## Alternatives rejected

- Keep alias matching and add more aliases: any value can be given any
  alias, so no alias list guarantees the value is the group size.
- Give `district_insights` its own allowlist and checks: two copies of a
  privacy control drift. The tool imports the Chief of Staff's instead.
- Import `validateConstituentSql` from `queryConstituentData.tool.ts`:
  that file already imported the base validator from
  `districtInsights.tool.ts`, so this would create an import cycle.
