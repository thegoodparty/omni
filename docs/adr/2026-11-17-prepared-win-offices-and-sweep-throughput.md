---
title: Ever-Pro campaigns get their office prepared before a result, and the win sweep is paced by the queue, not a batch cap
status: active
decided_by: [swain]
date: 2026-11-17
code: []
scope:
  - packages/gp-api/src/electedOffice/**
  - packages/gp-api/prisma/schema/electedOffice.prisma
  - packages/gp-api/src/jobs/jobs.registry.ts
  - packages/gp-api/src/organizations/services/organizations.service.ts
  - packages/contracts/src/campaigns/ElectedOffice.schema.ts
  - packages/gp-webapp/app/dashboard/shared/DashboardLayout.tsx
supersedes: ['2026-11-02-every-win-creates-a-dormant-office.md']
superseded_by:
---

# Ever-Pro campaigns get their office prepared before a result, and the win sweep is paced by the queue, not a batch cap

## Decision

`ElectedOfficeWinSource` gains `pending`. An office with `winSource: pending`
and `onboardingCompletedAt` null is prepared: dormant and invisible, hidden
from the org list, from the Win dashboard's Serve onboarding redirect, and
from the HubSpot Office Holder sync. `GET /v1/elected-office/mine` reports it
as `prepared`, and `isPreparedOffice` in `util/electedOffice.util.ts` is the
only definition of the state.

The daily `winOfficeSweep` builds one for every campaign that was ever Pro
(`campaignWasEverPro`), has no result on record, and whose election date
passed no more than 30 days ago, when the campaign has no office. It is shaped
exactly like a win office. Its meeting schedule and ordinance sourcing fire
immediately instead of at the pledge, so that research is already there when
the result lands, but its community issues do not: their run completion emits
Segment events that send the holder a HubSpot "your issues are ready" email,
and a candidate with no result yet may have lost. Serve onboarding runs its
own quick community-issue starter, and the full run still happens at the
pledge. The briefing chain and every scheduled Serve job stay gated on
`onboardingCompletedAt`.

A result resolves it, from any source. A win replaces `pending` with the real
source and syncs HubSpot; a loss deletes it through the existing withdrawn-win
path; no result leaves it. The same sweep no longer caps its work at 200
creates and 200 removals a run: it enqueues every eligible campaign as a
keyed `winOfficeSync` job, and that queue's `maxConcurrent` (3, sized to
HubSpot's private-app rate limit) paces the creates and their syncs.

## Context

Bryan's record (`2026-11-02-every-win-creates-a-dormant-office.md`, #3494)
established that every won campaign gets one dormant office, from any source,
created when the result is known, with a 200-a-run sweep catching the
pipeline's writes. That still holds for wins. What it did not cover is the
time before a result: most users never get a DDHQ result through in time, so
the office was being created at "I won" — too late for the meeting schedule,
community issues and ordinances those Serve surfaces need, which meant the
first sessions after onboarding were empty. The duty is knowable earlier: the
campaign ran, it was ever Pro, and the election date has passed without a
result yet.

The sweep's 200-a-run cap existed to stop that first backfill (~3,100 past
wins) from bursting creates and HubSpot syncs. A cap only pushes the rest of
that queue to the next day and makes the run's progress depend on ordering;
pg-boss already has a fleet-wide cap for exactly this shape of problem
(`src/jobs/AGENTS.md` § Fleet-wide cap), which is the throughput control the
cap was standing in for.

## Alternatives rejected

- **Prepare only the campaigns staff are about to let into Serve.** Staff do
  not know who won either, and the preparation is what they would need first.
- **Prepare every campaign, Pro or not.** Serve opens to ever-Pro winners
  only; a never-Pro campaign's office would be research bought for nobody.
- **Fire all three create-time dispatches at prepare time.** The
  community-issue run's completion emits Segment events that trigger a HubSpot
  email, so a not-yet-onboarded holder who may have lost would be told their
  issues are ready — and the event fires once per org, so the win would not
  re-send it when it would make sense.
- **Fire only the meeting schedule at prepare time.** Ordinances are the same
  long-lead research and drive no HubSpot notification, so they earn their
  place; leaving them to the pledge is a fresh first session with no code to
  review.
- **No window at all.** A missing result months later is the pipeline's
  problem, not a race, and the office would sit dormant behind a candidate
  who may never enter Serve.
- **Keep the 200-a-run cap and add `maxConcurrent` as well.** Two throttles
  for one limit, and the cap still ties progress to run order.
- **Leave `2026-11-02-every-win-creates-a-dormant-office.md` in force and add
  a second path.** Two notions of when an office may exist would drift; the
  prepared state is a third `winSource` on the same office, so there is still
  one create path.
- **Show prepared offices in the org list and dashboard.** The candidate has
  not won; prompting them to serve would be wrong and would spend Serve
  onboarding on a campaign still in progress.

## Revisit if

Serve opens to every winner, the pipeline starts writing results through the
gp-api API (which would make the win in-app rather than swept), or a
prepared office's agent runs become expensive enough to need their own gate.
