---
title: Test state borrows a real office, never a real election date
status: active
decided_by: [agent]
date: 2026-10-23
code: ['#3190']
scope:
  - packages/gp-api/src/testFixtures/**
  - packages/gp-api/src/testMode/**
  - packages/gp-api/src/chats/evals/judge/judgeIdentifiers.ts
  - packages/gp-webapp/e2e-tests/tests/utils/**
---

# Test state borrows a real office, never a real election date

## Decision

Automated callers that need a campaign (e2e helpers, test-fixtures routes,
staff Test mode, the judge sweep) take only the office from a real race, for
its position, district and voter data. They resolve it whatever the date: the
office's next upcoming race, else its most recent past one
(`testFixtures/util/fixtureRace.util.ts`). The election date always comes from
a Test mode election preset, computed on gp-api's clock
(`StateTransitionsService.electionPresetDate`), and is written before launch.
E2E reaches both through session-tier fixture routes, and still creates the
campaign through the product's `POST /v1/campaigns`.

## Context

All four callers looked up `Cheyenne City Council - Ward 1` in the future-only
race search and kept its real date. When that race crossed the 19-day texting
cutoff, the release train was blocked for 88 hours. Its only upcoming race was
2026-11-03, so from 2026-11-04 every spec that created a campaign would have
failed, and prod Test mode could no longer create on that office.

## Alternatives rejected

- **Keep the real date and pin it per spec.** Ten-plus specs already did this
  by PUTting `electionDate` to today + 60 or + 90. That spreads date math across
  the runner and still breaks on resolution once the race passes.
- **Create the whole e2e campaign through a fixture route.** It would stop ~40
  specs from exercising the product create route, and it would change their
  starting state in ways that are hard to audit.
- **A fully synthetic election database or a gp-api clock override.** Much
  larger. A clock seam remains a possible follow-up for testing transitions.

## Revisit if

Tests need to cross a date boundary (election day, the texting cutoff) inside
one run. That needs a server-side clock seam, not more presets.
