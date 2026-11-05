---
title: E2E specs read analytics events from a trackEvent seam, not the network
status: active
decided_by: [agent]
date: 2026-11-03
code: ['#3625']
scope:
  - packages/gp-webapp/helpers/analyticsHelper.ts
  - packages/gp-webapp/e2e-tests/src/helpers/analyticsEvents.helper.ts
  - .github/workflows/gp-webapp.yml
supersedes: []
superseded_by:
---

# E2E specs read analytics events from a trackEvent seam, not the network

## Decision

`trackEvent` hands every call, with its merged properties, to
`window.__gpAnalyticsEvents` when that object exists. Only the Playwright init
script in `e2e-tests/src/helpers/analyticsEvents.helper.ts` creates it, and it
forwards each call to the test through an exposed function. `expectEvent`
asserts against those records. `E2E_EVENT_ASSERTIONS` (off | shadow | block) in
`.github/workflows/gp-webapp.yml` decides whether a miss is reported or fails
the required E2E check.

## Context

DATA-2754 makes a flow's events part of the merge gate. The E2E suite runs
against the PR's Vercel preview, and on main against dev. On 2026-11-03 neither
build loaded Segment: no settings fetch to `/mx/v1/projects/*` and no
`/mx/evs/*` traffic, while prod made both. The write key is not set for those
environments, so a helper that listened to Segment requests would record
nothing on any PR.

## Alternatives rejected

- **Listen to `/mx/evs/*` requests.** Records nothing on previews and dev, as
  above. It would also only work while Segment loads, which a blocked or slow
  settings fetch breaks.
- **Set a Segment write key on preview and dev builds.** Needs a separate
  Segment source so E2E traffic stays out of prod data, sends every E2E run's
  events into that source, and makes the check depend on a third-party fetch.
  It tests delivery, which is Segment's job, rather than whether the code makes
  the call with the right properties, which is the gap the check exists for.

## Revisit if

Preview builds get a write key for another reason and delivery itself needs
testing. The seam can then sit alongside a network listener.
