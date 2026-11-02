---
title: The dashboard routes only Pro winners to Serve onboarding, and gp-api says which office is Pro
status: active
decided_by: [bryclevgp]
date: 2026-11-02
code: ['#3487']
scope:
  - packages/gp-webapp/app/dashboard/election-result/**
  - packages/gp-webapp/app/dashboard/shared/DashboardLayout.tsx
  - packages/gp-webapp/app/serve/onboarding/**
  - packages/gp-api/src/electedOffice/electedOffice.controller.ts
  - packages/contracts/src/campaigns/ElectedOffice.schema.ts
supersedes: ['2026-10-28-win-offices-start-unfinished.md']
superseded_by:
---

# The dashboard routes only Pro winners to Serve onboarding, and gp-api says which office is Pro

## Decision

A Pro winner's office still starts unfinished, checkpointed on Serve
onboarding's `confirm` step, and the pledge stamps `onboardingCompletedAt`.
`DashboardLayout`, not sign-in routing, sends a user back to
`/serve/onboarding` on every dashboard visit only when they hold a
`campaignId` office without the stamp whose linked campaign is Pro.
`GET /v1/elected-office/mine` carries that as `campaignIsPro`, validated by
`MyElectedOfficeSchema` in `@goodparty_org/contracts`. An unfinished office
alone does not route anyone: Serve opens to non-Pro winners a group at a time.

## Context

Every win is about to create an office, Pro or not, so "holds an unfinished
`campaignId` office" no longer means "Pro winner". Sign-in routing
(`/post-auth-redirect`, `candidateAccess.ts`,
`resolvePostAuthRedirectPath.util.ts`) still leaves win-origin offices alone.

## Alternatives rejected

- **Match `office.campaignId` to `useCampaign()` in the browser.** The
  campaign context is null whenever the active org is an `eo-*` org, so a Pro
  winner on their office's org would stop being routed.
- **Change sign-in routing.** Ruled out for the earlier record and still out.

## Revisit if

Serve opens to every winner, or Pro lapsing should stop the handoff mid-way.
