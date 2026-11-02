---
title: A win, from any source, creates a dormant office; only finished offices get Serve jobs or redirects
status: active
decided_by: [bryclevgp]
date: 2026-11-02
code: ['#TBD']
scope:
  - packages/gp-api/src/electedOffice/**
  - packages/gp-api/src/campaigns/campaigns.controller.ts
  - packages/gp-api/src/admin/campaigns/adminCampaigns.service.ts
  - packages/gp-api/src/organizations/services/organizations.service.ts
supersedes: ['2026-10-28-win-offices-start-unfinished.md']
superseded_by:
---

# A win, from any source, creates a dormant office; only finished offices get Serve jobs or redirects

## Decision

Every won campaign gets one elected office linked by `campaignId`, Pro or
not, whether the win was self-reported (`details.wonGeneral`), recorded by
staff (`didWin` through the admin console or the M2M campaign update), or
written by the data pipeline from DDHQ (`didWin` or
`data.hubSpotUpdates.election_results` straight to Postgres). The office is
dormant until its holder finishes Serve onboarding: `ElectedOfficeService`
skips the create-time agent dispatches for an office created without
`onboardingCompletedAt` and fires them at the pledge, the scheduled Serve
jobs already skip it (#3486), and it never leads the org list. The in-app
paths create or remove it at once; a daily sweep
(`WinOfficeService.sweepOnce`, 200 a run) catches the pipeline's writes and
is the backfill. The sweep skips Pro wins whose election is over a year old,
because a Pro winner's unfinished office redirects them to Serve onboarding
on every dashboard visit; staff can still send those winners there. `elected_office.win_source` records the first source to create
it. A win withdrawn (a loss, or a new race clearing the result) deletes a
dormant win office with its `eo-<id>` org; a finished office is never
deleted.

## Context

Serve opens a few people at a time: staff send chosen winners to
`/serve/onboarding`, and Pro winners keep the dashboard handoff. That needs
an office ready for every winner without spending agent runs or pushing
anyone. DDHQ results never pass through gp-api code, so an in-app hook alone
would miss most wins.

## Alternatives rejected

- **Create offices only at the moment staff let someone in.** Staff would
  have to supply the position, party and term each time, and a pipeline win
  would have no office to open.
- **Hook only the in-app writes.** Misses every DDHQ result.
- **Gate the create-time dispatch on the win source.** Leads and net-new
  offices are created unfinished too; gating on "unfinished" keeps one rule,
  and their dispatches move to the pledge.

## Revisit if

Serve opens to every winner, or the pipeline starts writing results through
the gp-api API.
