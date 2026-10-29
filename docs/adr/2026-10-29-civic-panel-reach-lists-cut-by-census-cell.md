---
title: A civic panel's door and call lists are frozen samples cut by the census cell its seats were counted in
status: active
decided_by: [agent]
date: 2026-10-29
code: ['#3426']
scope:
  - packages/gp-api/src/contacts/services/civicPanelReach.service.ts
  - packages/gp-api/src/peopleDb/databricks/districtCensusSql.util.ts
  - packages/contracts/src/people/CivicPanelReach.schema.ts
supersedes: []
superseded_by:
---

# A civic panel's door and call lists are frozen samples cut by the census cell its seats were counted in

## Decision

`POST /v1/contacts/civic-panel/reach-lists` saves a group still short of
its civic panel seats as an ordinary list frozen as a sample: the person
ids `buildReachPeopleSql` returns for that group's census cell (the same
`ageBandSql`, `genderSql`, `raceSql` and `tractSql` expressions the seats
were counted in, or a precinct's county and precinct), with no cell phone
on file (and a landline for a call), leaving out members and who left.
The list keeps `hasLandline` for a call; nothing else of the group lives
on the list's criteria.

## Context

An exhausted managed civic panel has texted everyone with a cell phone, so
the official reaches the rest at the door or on a call, through the
existing flows, which open on a saved list. The groups the page lists are
census cells: six census age bands, census sex, tract and folded race. The
saved list filter has none of them exactly (its age buckets are 35 to 49
and 50 to 64, it has no tract, and "no cell phone" cannot be saved).

## Alternatives rejected

- Map each group to the closest saved filter: the list would hold people
  the row did not count (35 to 49 for "35 to 44") and no tract at all.
- Add tract, census age bands and "no cell phone" to the people filters
  and `VoterFileFilter`: a migration and every filter path (counts, lists,
  the assistant's tools) for one button's audience.
- A weighted sample draw: weights are positive, so a draw can lean toward
  a cell but never keep to it.

## Revisit if

The list filters gain census cells, or the frozen list should shed people
who later join the civic panel or get a cell phone on file.
