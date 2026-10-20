---
title: gp-api decides whether our candidate runs in the primary; the warehouse does not publish it
status: active
decided_by: [danpelota]
date: 2026-09-13
code: ['#PR']
scope:
  - packages/gp-api/src/elections/util/primaryBallot.util.ts
  - packages/gp-api/src/elections/services/ballotReady.service.ts
  - packages/gp-api/src/electionDb/campaignStrategyContext/campaign-strategy-context.service.ts
supersedes: []
superseded_by:
---

# gp-api decides whether our candidate runs in the primary; the warehouse does not publish it

## Decision

A primary date belongs to the race, but our candidates are never major-party
nominees, so in a partisan race they reach the general ballot by petition and
never run in the party primary. The exception is AK, CA, LA and WA, which put
every candidate on one primary ballot. `candidateRunsInPrimary` holds that
rule in gp-api, and both places that attach a sibling primary date to a
campaign's race consult it: the onboarding race lookup and the campaign
strategy context.

## Context

Independents in partisan races were getting the party primary date. It was
saved to `campaign.details.primaryElectionDate`, sent to HubSpot as
`primary_date` and used by the campaign tracker. The vendor data cannot settle
the question: BallotReady files independent candidacies against primary races
(the 2026 Florida governor primary lists eight), so a rule derived from race
membership inherits that error.

## Alternatives rejected

- **A curated state table in dbt, published as a column on the election-api
  race mart.** The fact is a four-state constant the warehouse cannot derive.
  Publishing it would copy it onto every race row and cost an election-db
  migration and a sync dependency, only to reach readers that already know the
  state and partisan type.

## Revisit if

Onboarding starts accepting major-party candidates, or it starts telling
ballot-qualified minor parties (which hold their own primaries in NY, MO, OH
and other states) apart from independents.
