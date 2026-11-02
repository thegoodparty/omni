---
title: The dashboard routes winners whose campaign was ever Pro to Serve onboarding
status: active
decided_by: [bryclevgp]
date: 2026-11-02
code: ['#PR']
scope:
  - packages/gp-webapp/app/dashboard/election-result/**
  - packages/gp-webapp/app/dashboard/shared/DashboardLayout.tsx
  - packages/gp-webapp/app/serve/onboarding/**
  - packages/gp-api/src/electedOffice/electedOffice.controller.ts
  - packages/contracts/src/campaigns/ElectedOffice.schema.ts
supersedes:
  ['2026-11-02-dashboard-routes-only-pro-winners-to-serve-onboarding.md']
superseded_by:
---

# The dashboard routes winners whose campaign was ever Pro to Serve onboarding

## Decision

A winner's office starts unfinished, checkpointed on Serve onboarding's
`confirm` step, and the pledge stamps `onboardingCompletedAt`.
`DashboardLayout` sends a user back to `/serve/onboarding` on every dashboard
visit when they hold a `campaignId` office without `onboardingCompletedAt`
whose linked campaign was ever Pro. gp-api decides it in
`GET /v1/elected-office/mine` as `campaignWasEverPro`, validated by
`MyElectedOfficeSchema`: `isPro` is true, or `details.isProUpdatedAt`,
`details.subscriptionId` or `details.subscriptionCanceledAt` is set (JSON null
does not count). Sign-in routing is still unchanged.

## Context

Many winners cancel Pro after election day. Under the current-Pro gate they
were held on the Win dashboard with an unfinished office. A downgrade nulls
`subscriptionId` but leaves `isProUpdatedAt` and `subscriptionCanceledAt`,
so the campaign row already records that it was Pro once.

## Alternatives rejected

- **Keep the current-Pro gate.** Strands winners who cancelled after winning.
- **Route every unfinished win office.** Serve still opens to never-Pro
  winners a group at a time.

## Revisit if

Serve opens to every winner.
