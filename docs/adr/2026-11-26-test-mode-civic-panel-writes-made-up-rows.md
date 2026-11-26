---
title: Test mode's civic panel writes made-up rows on the test org, and the jobs skip test orgs
status: active
decided_by: [bryclevgp]
date: 2026-11-26
code: ['claude/amazing-mendel-2x993z']
scope:
  - packages/gp-api/src/testMode/**
  - packages/gp-api/src/managedPanelWaves/**
  - packages/gp-api/src/priorities/services/priorityRead.service.ts
  - packages/gp-api/src/priorities/services/priorityAnswerCoding.service.ts
---

# Test mode's civic panel writes made-up rows on the test org, and the jobs skip test orgs

## Decision

The Test mode `civicPanel` family walks a staff test org's managed civic
panel through its milestones and one shared priority through its answers by
writing ordinary rows (panel, members, text send, replies, coded answers,
themes) on that test org. Every person in them is a made-up id (a uuid v5 of
the org slug and an index), never a voter file id, and every reply is from
one shared fixture (`src/testMode/fixtures/civicPanel.fixture.ts`). The rows
cascade away with the org. Three background paths skip any org with
`testModeCreatedAt`: the managed panel wave fan-out (no draws, texts,
confirmation or milestone events), the answer coding sweep (no model calls
on made-up replies) and the priority read (stored as no read, since the
warehouse has never heard of these people, so the count alone decides).

## Context

Staff need to see the civic panel and a priority's results in each state in
prod, where Test mode runs. Fake constituent responses must not land on real
people or reach real data stores, and a test org's panel must never text a
real resident.

## Alternatives rejected

- **A virtual fixture served at read time.** No rows, but every read path
  (panel summary, results, read, themes, comments) would need a fake branch,
  and staff would be looking at a mock rather than the product.
- **Real people sampled from the district,** as the dev activity seed does.
  It attaches made-up answers to real people's records.

## Revisit if

Test orgs ever send real outreach whose replies should be coded or read.
