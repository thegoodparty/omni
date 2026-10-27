---
title: The sign-up claim panel flag is evaluated for anonymous visitors by the sign-up page itself
status: active
decided_by: [tonypham-goodparty]
date: 2026-10-23
code: ['#3286']
scope:
  - packages/gp-webapp/app/sign-up/**
  - packages/gp-webapp/env.schema.ts
supersedes: []
superseded_by:
---

# The sign-up claim panel flag is evaluated for anonymous visitors by the sign-up page itself

## Decision

`signup-profile-claim-variation` is the one flag gp-webapp evaluates for a
logged-out visitor. The sign-up page's server code asks Amplitude directly
(`@amplitude/experiment-node-server`, remote evaluation) and only when the
request carries `signup_source=profile_claim`. The visitor is identified by
the Segment anonymous id in the `ajs_anonymous_id` cookie, sent as
`device_id`. The deployment key is the server-only
`AMPLITUDE_EXPERIMENT_DEPLOYMENT_KEY`. A missing key or cookie, an Amplitude
error, or no answer within a second reads as off.

## Context

The shared `FeatureFlagsProvider` resolves flags through gp-api, for signed-in
users only, and the browser never calls Amplitude. Visitors from a /people
profile's "Claim this profile" link are signed out, so the provider can only
ever read this flag as off. The panel has to be decided before render so it
does not swap after first paint. Segment sets its cookie on the top-level
domain, so the marketing site and the app share the id, and the app's
`$exposure` events already go through Segment under it.

## Alternatives rejected

- Resolving anonymous visitors in the shared provider: it changes every flag
  the app reads for every logged-out page view and goes against the provider's
  documented design.
- A public gp-api endpoint for anonymous flags: a cross-package change and a
  new unauthenticated surface, for a single flag on a single page.
- The marketing site's Amplitude device id: a different value from the Segment
  id, under a cookie named after the marketing site's API key.

## Revisit if

A second logged-out surface needs a flag. Then a gp-api endpoint with an
allow-list is likely the better shared answer.
