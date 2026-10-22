---
title: A civic panel's active members are read live from the answer rows, never stored
status: active
decided_by: [bryclevgp]
date: 2026-10-20
code: ['#3035']
scope:
  - packages/gp-api/src/contacts/services/civicPanelBuildPlan.service.ts
  - packages/gp-api/src/priorities/util/priorityRespondents.util.ts
supersedes: []
superseded_by:
---

# A civic panel's active members are read live from the answer rows, never stored

## Decision

Past its goal, a civic panel is kept fresh by active coverage: every major
group holds at least `PANEL_MEMBERS_PER_GROUP` active members, where an active
member is a panel member who answered a priority's text, call or door in the
last `PANEL_ACTIVE_WINDOW_DAYS` (90) days. "Active" is computed on every plan
read from the answer rows (`answeredPersonIds` with a `since`), intersected
with the members, then counted by group through the same census read as the
members. It is not a column, a status or a job.

## Context

The first keep-fresh plan asked for members plus 50 more. Bryan decided that
freshness is who is still answering, group by group, not a headcount. The
answers already live in `PollIndividualMessage` and the call and door
interaction tables, and the plan read already derives step status and
progress from those same rows on every read.

## Alternatives rejected

- A `last_answered_at` column on the civic panel status, kept up to date as
  answers arrive. Three write paths (text replies, calls, doors) would each
  need to maintain it, and a missed one silently ages a member out. The read
  is a few indexed queries over one office, cheaper than that drift.
- A scheduled job that materialises each office's active set. Adds a cron and
  a staleness window for a number the page reads once a visit.
- Counting active members in the warehouse. The answers are in Postgres, not
  the people database, and the member ids already go to it for the census cells.

## Revisit if

An office's panel grows large enough that the answered-person read is slow on
every plan read (cache it per office the way the census cells are cached), or
the window or the per-group threshold is made configurable per office.
