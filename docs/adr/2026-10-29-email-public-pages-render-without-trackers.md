---
title: The /email public pages render from the root layout with no third-party script or analytics
status: active
decided_by: [stephtea]
date: 2026-10-29
code: ['#3367']
scope:
  - packages/gp-webapp/app/layout.tsx
  - packages/gp-webapp/app/email/**
supersedes: []
superseded_by:
---

# The /email public pages render from the root layout with no third-party script or analytics

## Decision

For any path under `/email/`, the root layout skips GTM/GA4, VWO, HubSpot,
the route tracker, Segment/Amplitude init, session replay and the service
worker, and renders only the document shell and the React Query provider. The
URLs stay as they are. The path comes from the `x-pathname` header that
`middleware.ts` sets.

The unsubscribe and forward-confirm links carry a signed token in the path. It
contains the recipient's address and works as a credential, so it must not
reach a third party.

## Context

Links in emails already sent point at `/email/unsubscribe/<token>` and
`/email/forward-confirm/<token>` and must keep working. The root layout loaded
every tracker on every page.

## Alternatives rejected

- Move the token into the URL fragment: changes how gp-api builds links, and
  breaks links already sent.
- A route group with its own root layout: requires moving every other route
  into a group, a large diff for one exclusion.

## Revisit if

A token's path matches the middleware's static-file matcher (a `.js`, `.css`
or similar extension after a dot), which skips the middleware and so
`x-pathname`.
