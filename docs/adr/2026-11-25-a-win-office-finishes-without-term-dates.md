---
title: A win office finishes Serve onboarding without term dates, and its term starts on the first meeting the winner confirms
status: active
decided_by: [agent]
date: 2026-11-25
code: []
scope:
  - packages/gp-api/src/electedOffice/electedOffice.controller.ts
  - packages/gp-api/src/electedOffice/util/electedOffice.util.ts
  - packages/gp-api/src/electedOffice/services/winTerm.service.ts
  - packages/gp-api/src/campaigns/util/eligibility.util.ts
  - packages/gp-webapp/app/serve/onboarding/**
supersedes: ['2026-10-28-win-offices-start-unfinished.md']
superseded_by:
---

# A win office finishes Serve onboarding without term dates, and its term starts on the first meeting the winner confirms

## Decision

Decided by Olly Farshi, the design owner of the warm welcome, on Nov 25, 2026.
He has no GitHub handle on record here, so `decided_by` is `[agent]`. This
reverses part of a decision by Bryan Levine (`bryclevgp`), whose agreement is
being sought in the PR.

`PUT /v1/elected-office/:id` no longer needs both term dates to stamp
`onboardingCompletedAt` on an office a win created (`campaignId` set). Serve
onboarding sends the first meeting date the winner confirmed as
`termStartDate`. With a start and no end, gp-api sets the end to the start
plus the seat's term length, the first gap of the race's election cadence
(`Race.frequency`, by the campaign's `details.raceId`). With no length on file
the end stays null. With no dates at all the office still finishes. If the
worked-out term overlaps another office the user holds, the office finishes
and keeps the term it had.

A finished win office with no end date is held: `deriveIsActive` answers for
the API's `isActive`, the org list's status and order, and eligibility. The
existing dashboard term-date modal asks for whatever is missing, and the
winner can correct a derived term there or in their profile.

Offices that did not come from a win keep the rule: no completion without both
dates.

## Context

`2026-10-28-win-offices-start-unfinished.md` created a winner's office with "no
guessed term" and rejected deriving one, because the race carries only a term
length and not a start date, so the term step asked. The records that
superseded it were about routing and never restated the term rule, but the
code kept it: the completion write was refused without both dates.

The warm welcome has no term step. Measured on Nov 25, 3 of 2,795 offices
created for winners found from election results had both dates, so a welcome
that needed them would open for almost nobody. The first meeting date is the
start the winner can actually give, and the term length was already in the
election database.

## Alternatives rejected

- **Open the welcome only for offices that already have both dates.** Almost
  no winner would see it.
- **Add a term step to the welcome.** A new winner often does not know the
  dates, and the design has no such step.
- **Derive the term from the election date and the term length.** The seat is
  not taken on election day; the first meeting is a date the winner confirms.
- **Refuse the finish when the derived term overlaps an office they hold.** A
  re-elected incumbent's next meeting falls inside their current term, so they
  could never finish.
- **Store a guessed end when the term length is unknown.** A wrong end date
  would later read the office as ended.

## Revisit if

BallotReady office-holder records start arriving before winners finish
onboarding, or the first meeting date proves a poor stand-in for the start of
a term.
