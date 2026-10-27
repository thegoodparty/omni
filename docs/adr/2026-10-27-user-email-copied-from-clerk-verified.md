---
title: User.email is copied from Clerk, never written by the user
status: active
decided_by: [agent]
date: 2026-10-27
code: ['#3306']
scope:
  - packages/gp-api/src/users/**
  - packages/gp-api/src/vendors/clerk/**
  - packages/gp-api/src/authentication/**
  - packages/gp-webapp/app/shared/user/UserProvider.tsx
supersedes: []
superseded_by:
---

# User.email is copied from Clerk, never written by the user

## Decision

A user cannot write their own `User.email`. `PUT /v1/users/me` strips it.
gp-api copies the email from Clerk: the primary address once at provisioning,
and afterwards only a verified primary, through `POST /v1/users/me/sync-email`,
which takes no body and re-reads the Clerk user server-side. The webapp calls
it when Clerk's verified primary differs from `User.email`, which is what
happens after a user changes their email in Clerk's profile modal. M2M
`PUT /v1/users/:id` (gp-admin) still writes it.

Provisioning trusts the primary without checking its status because the prod
Clerk instance verifies email at sign-up (`verify_at_sign_up: true`). The dev
instance does not, so e2e sign-ups skip the code; there `User.email` is not a
trust boundary, and the non-prod test endpoints it unlocks are dev-only by
design.

## Context

`User.email` decides staff and test-user privilege: `isInternalUser`,
`isTestUser`, `TestModeGuard`, the community-issues staff dispatch and the
free robocall offer's staff bypass all read it. `PUT /v1/users/me` accepted
`email` with no verification, so any user could set `x@goodparty.org` and pick
up staff affordances. Clerk already verifies email changes, but gp-api only
read Clerk's email once, at first sign-in, so a Clerk-side change never
arrived.

## Alternatives rejected

- Clerk `user.updated` webhook. The canonical sync, but it needs a Svix
  endpoint, a signing secret per environment and dashboard configuration in
  each Clerk instance. The client-triggered sync reaches the same state the
  next time the user opens the app. A lag only delays a legitimate change; it
  can never let an unverified address in.
- Fetch the Clerk user on every request. One Clerk round-trip per request,
  which `SessionGuard` deliberately avoids.
- Move every privilege check to Clerk. Many checks run off rows loaded for
  other users (crons, CRM sync, reports), where a Clerk call per row is not
  viable.

## Revisit if

Prod Clerk stops verifying email at sign-up; provisioning would then need to
check the status too. Or something needs `User.email` current while the user is not using the app (an
email address changed in Clerk by staff, say). Then add the webhook.
