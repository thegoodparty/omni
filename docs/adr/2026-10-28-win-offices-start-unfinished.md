---
title: A Pro winner's office starts unfinished, and the dashboard routes it to Serve onboarding
status: active
decided_by: [bryclevgp]
date: 2026-10-28
code: ['#3322']
scope:
  - packages/gp-webapp/app/dashboard/election-result/**
  - packages/gp-webapp/app/dashboard/shared/DashboardLayout.tsx
  - packages/gp-webapp/app/serve/onboarding/**
---

# A Pro winner's office starts unfinished, and the dashboard routes it to Serve onboarding

## Decision

When a Pro candidate says they won, the elected office is created from the
campaign org with no `onboardingCompletedAt` and no guessed term, checkpointed
on Serve onboarding's `confirm` step. Serve onboarding's pledge sets the stamp,
as it does for every other office. `DashboardLayout`, not sign-in routing, sends
a user who holds a `campaignId` office without the stamp back to
`/serve/onboarding` on every dashboard visit until then. Winners without Pro get
no office. Offices already stamped are left as they are; nothing is backfilled.

## Context

The "I won" step used to create the office already stamped, with term dates
collected inline, so a winner skipped Serve onboarding entirely and landed on
the Chief of Staff with no district story and no priorities. Sign-in routing
(`/post-auth-redirect`, `candidateAccess.ts`,
`resolvePostAuthRedirectPath.util.ts`) treats a `campaignId` office as never
needing onboarding, and it also serves people with no account who go straight
into Serve onboarding, so it stays untouched.

## Alternatives rejected

- **Keep creating the office stamped and link to onboarding.** The stamp is
  what Serve onboarding's page and the term-dates modal read as "done", so
  onboarding would redirect away from itself.
- **Change sign-in routing to send unfinished win offices to onboarding.**
  Bryan ruled out touching those files; the dashboard redirect reaches the same
  users on their next dashboard visit.
- **Derive term dates from BallotReady in the browser.** A fresh winner has no
  officeholder record yet and the race only carries a term length, not a start
  date, so onboarding's term step asks instead.

## Revisit if

Sign-in routing is reworked, or a winner's term start becomes known at the
moment they say they won.
