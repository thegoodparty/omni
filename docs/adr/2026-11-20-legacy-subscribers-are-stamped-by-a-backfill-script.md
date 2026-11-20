---
title: Legacy Pro subscribers get their plan columns from a manual backfill script, not a migration
status: active
decided_by: [agent]
date: 2026-11-20
code: ['#3959']
scope:
  - packages/gp-api/scripts/backfill-subscription-plan-columns.ts
  - packages/gp-api/src/campaigns/plans/campaignPlanPurchase.service.ts
supersedes: []
superseded_by:
---

# Legacy Pro subscribers get their plan columns from a manual backfill script, not a migration

## Decision

Campaigns that subscribed before the plan columns shipped sit on the defaults
(`plan = 'free'`, `plan_pricing_model` null). A dry-run-by-default script,
`scripts/backfill-subscription-plan-columns.ts`, stamps `plan = 'pro'` and
`plan_pricing_model = 'subscription'` on every `is_pro` campaign with a
`details.subscriptionId` and those defaults, and nothing else. An operator runs
it before `win_per_campaign_pricing` ramps. The purchase guard does not depend
on it: `onLiveSubscription` also reads `isPro` plus the subscription id, so a
subscriber that has not been stamped yet still cannot buy a plan or have one
fulfilled.

## Context

Product requires a legacy subscriber's experience to stay unchanged with the
flag on. Every flag-on reader (plans page, credit lines, expiry sweep, CRM
sync, drift report) keys off the plan columns, so stamping the rows fixes them
all at once, where patching each reader leaves the next one wrong.

## Alternatives rejected

- **A Prisma migration.** It would stamp rows on every deploy and in every
  environment with no dry run and no list of the ids it touched, for a one-off
  correction of a few live subscribers.
- **Patch each reader to fall back to `isPro` plus the subscription id.** Many
  readers, several in SQL, and each new one repeats the mistake.
- **Route the backfill through `setIsPro`.** That fires the Pro transition
  and its side effects for people who are already Pro.

## Revisit if

Subscriptions stop being sold, so no row is ever unstamped again and the
guard's `isPro` fallback can go.
