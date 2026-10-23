---
title: Org-scoped feature flags are evaluated for the org's owner, on the routes and in the variants endpoint
status: active
decided_by: [agent]
date: 2026-10-21
code: ['#3098']
scope:
  - packages/gp-api/src/features/**
  - packages/gp-api/src/constituentFeedback/constituentFeedback.controller.ts
  - packages/gp-webapp/app/shared/organization-picker.tsx
supersedes: []
superseded_by:
---

# Org-scoped feature flags are evaluated for the org's owner, on the routes and in the variants endpoint

## Decision

Flags in gp-api's `ORGANIZATION_FLAGS` (today only `issue-capture`) are
evaluated for the owner of the organization a request acts in, whoever is
signed in. Routes gated on one pass `organization.ownerId` to
`isFeatureEnabled`. `GET /v1/experiment/variants` resolves the request's org
(`@UseOrganization({ continueIfNotFound: true })`, `@AllowVolunteer()`) and
returns these flags from the owner's evaluation, every other flag from the
user's. The webapp keeps reading flags through its one provider and
re-resolves when the active org changes.

## Context

Amplitude buckets by user id. On Win, volunteers do most of the door
knocking, so under a percentage or cohort rollout of `issue-capture` a
candidate and their volunteers landed in buckets independently: a flagged
campaign's volunteers mostly saw no capture, and some volunteers of an
unflagged one did. The synthesis trigger already asked the org's owner; the
routes and every webapp surface asked the person.

## Alternatives rejected

- **A dedicated `GET /v1/constituent-feedback/rollout` route read by its own
  webapp hook.** It bypasses the variants pipeline, so it loses the
  `e2e-flag-overrides` cookie and the preview default (gp-api reads every
  flag on under the placeholder key, the webapp reads them off), which would
  show the capture step in every knock and call spec on PR previews.
- **Owner evaluation for volunteers only.** Campaign managers would still be
  bucketed alone, so one org could disagree with itself.
- **Bucketing by an org group in Amplitude.** Needs groups set up in the
  project and an org identity sent with every evaluation; owner evaluation
  gets the same per-org consistency from the identities we already send.

## Revisit if

Orgs become Amplitude groups, or a flag needs to differ between members of
one org.
