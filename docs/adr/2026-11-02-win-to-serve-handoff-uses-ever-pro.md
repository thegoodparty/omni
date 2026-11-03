---
title: The Win to Serve handoff is for winners whose campaign was ever Pro
status: active
decided_by: [bryclevgp, jacknagel-hs]
date: 2026-11-02
code: ['#3518', '#3527']
scope:
  - packages/gp-webapp/app/dashboard/election-result/**
  - packages/gp-webapp/app/dashboard/shared/DashboardLayout.tsx
  - packages/gp-webapp/app/serve/onboarding/**
  - packages/gp-api/src/electedOffice/electedOffice.controller.ts
  - packages/gp-api/src/electedOffice/services/winOffice.service.ts
  - packages/gp-api/src/chats/general/product-knowledge/productMap.ts
  - packages/contracts/src/campaigns/ElectedOffice.schema.ts
  - packages/contracts/src/campaigns/CampaignEverPro.ts
  - packages/contracts/src/index.ts
supersedes:
  ['2026-11-02-dashboard-routes-ever-pro-winners-to-serve-onboarding.md']
superseded_by:
---

# The Win to Serve handoff is for winners whose campaign was ever Pro

## Decision

Decided by Bryan with Jack, Jesse, Jared and Chadwyck. Jesse, Jared and
Chadwyck have no GitHub handle in the org, so `decided_by` lists the two who
do.

Every step of the Win to Serve handoff keys on whether the winner's campaign
was ever Pro, never on Pro now. One definition, `campaignWasEverPro` in
`@goodparty_org/contracts`: `isPro` is true, or `details.isProUpdatedAt`,
`details.subscriptionId` or `details.subscriptionCanceledAt` is set (JSON null
does not count).

- The election result page gives an ever-Pro winner Get ready to serve and
  its Start preparing to serve button, which creates the office unfinished
  and opens Serve onboarding. A never-Pro winner gets the congratulations.
- `DashboardLayout` sends a user back to `/serve/onboarding` on every
  dashboard visit when they hold a `campaignId` office without
  `onboardingCompletedAt` whose campaign was ever Pro. gp-api answers it as
  `campaignWasEverPro` on `GET /v1/elected-office/mine`, since the active org
  can be the office's `eo-*` org, where the webapp has no campaign.
- The win-office sweep skips ever-Pro wins over a year old, so the backfill
  does not start that redirect for long-past winners. Its SQL mirrors the
  helper.

`ActiveProSubscriptionAlert` still reads Pro now: it is about a subscription
the winner still has to cancel. Sign-in routing is unchanged.

## Context

Many winners cancel Pro after election day. A downgrade nulls
`subscriptionId` but leaves `isProUpdatedAt` and `subscriptionCanceledAt`,
so the campaign row already records that it was Pro once. When only the
dashboard used ever Pro, a winner who cancelled saw the never-Pro
congratulations and was then sent to Serve onboarding anyway.

## Alternatives rejected

- **Keep the current-Pro gate.** Strands winners who cancelled after winning.
- **Route every unfinished win office.** Serve still opens to never-Pro
  winners a group at a time.
- **Copy the rule into each caller.** The page, the redirect and the sweep
  would drift apart, which is how the mismatch above happened.

## Revisit if

Serve opens to every winner.
