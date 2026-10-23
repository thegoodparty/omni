---
title: The civic panel's standing is read live on GET /civic-panel
status: active
decided_by: [bryclevgp]
date: 2026-10-23
code: ['#3183']
scope:
  - packages/gp-api/src/contacts/services/civicPanelSummary.service.ts
  - packages/contracts/src/people/CivicPanelSummary.schema.ts
supersedes:
  - 2026-10-20-civic-panel-active-members-read-live.md
superseded_by:
---

# The civic panel's standing is read live on GET /civic-panel

## Decision

`GET /v1/contacts/civic-panel` returns the panel's progress toward the
district's goal, its balance and its composition (seats by tract or
precinct) beside the member counts, and it replaces the plan read for the
panel page and the Constituents section. Past its goal the panel is judged
on active members: a member who answered a priority's text, call or door
in the last `PANEL_ACTIVE_WINDOW_DAYS` days, read live from the answer rows
(`answeredPersonIds` with a `since`) on every read, never stored.

## Context

The do-it-yourself build plan was deleted with the managed civic panel.
Its read was the only route that returned progress, balance and
composition, and the only place active members were counted. The rule for
active members is the earlier record's, unchanged; only where it is read
moved.

## Alternatives rejected

- A slim read-only plan route: keeps the plan's name on something that is
  no longer a plan.
- A stored last-answered column or a job that materialises the active set:
  rejected in the earlier record for drift across three write paths, and
  nothing about that has changed.

## Revisit if

The summary read gets slow for large panels (cache the answered-person read
per office, as the census mix already is).
