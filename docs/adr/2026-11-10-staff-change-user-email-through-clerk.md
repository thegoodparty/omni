---
title: Staff change a user's email through Clerk first, never by writing User.email
status: active
decided_by: [agent]
date: 2026-11-10
code: ['#3693']
scope:
  - packages/gp-api/src/users/**
  - packages/gp-api/src/vendors/clerk/**
  - packages/gp-admin/src/app/dashboard/users/**
supersedes: ['2026-10-27-user-email-copied-from-clerk-verified.md']
superseded_by:
---

# Staff change a user's email through Clerk first, never by writing User.email

## Decision

Nobody writes `User.email` directly. A user changes it in Clerk and the
webapp's `POST /v1/users/me/sync-email` copies the verified primary across,
as before. Staff use M2M `PUT /v1/users/:id/email`: it refuses an address
another gp-api user or another Clerk user holds, adds the address to the
user's Clerk account as a verified primary (keeping the old one as a
secondary, so an OAuth link to it still works), then writes `User.email`, then
points the user's HubSpot contact at it. M2M `PUT /v1/users/:id` no longer
accepts `email`.

Clerk moves before the database. If the database write fails after Clerk
changed, the user's next visit runs sync-email and copies Clerk's verified
primary across, so the two cannot stay split. The reverse order could leave a
`User.email` the user cannot sign in with.

HubSpot keys contacts on email, so when another contact already holds the new
address the endpoint changes nothing there and returns both contact ids; staff
merge them in HubSpot. A HubSpot failure never fails the change, because sign-in
and every product surface read Clerk and gp-api.

## Context

CS asked to change a candidate's email. gp-admin's email field was read-only,
and the M2M `PUT /v1/users/:id` it sat on wrote only `User.email`: Clerk kept
the old sign-in address and HubSpot the old contact email, and gp-admin shows
Clerk's copy, so the change looked like it had not happened. The old record's
"revisit if" named this case: an email staff change while the user is not in
the app.

## Alternatives rejected

- Keep the email on `PUT /v1/users/:id` and add the Clerk and HubSpot writes
  there. That route takes partial profile edits from a form; an email change
  needs its own checks and its own result (the HubSpot outcome), and a field
  that silently moves a sign-in identity is easy to submit by accident.
- Clerk `user.updated` webhook. Still needs per-instance Svix setup, and staff
  need the conflict checks synchronously, before anything moves.
- Remove the old address from Clerk. It would break a user whose Google
  sign-in is linked to the old address.
