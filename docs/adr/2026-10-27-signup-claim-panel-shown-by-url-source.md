---
title: The sign-up claim panel is shown by the profile claim link's URL source alone, with no flag
status: active
decided_by: [tonypham-goodparty]
date: 2026-10-27
code: ['#3292']
scope:
  - packages/gp-webapp/app/sign-up/**
  - packages/gp-webapp/env.schema.ts
supersedes: [2026-10-23-signup-claim-flag-evaluated-anonymously.md]
superseded_by:
---

# The sign-up claim panel is shown by the profile claim link's URL source alone, with no flag

## Decision

`/sign-up` shows `ClaimProfilePanel` in place of `MarketingPanel` whenever the
request carries `signup_source=profile_claim`, the parameter gp-marketing adds
to the "Claim this profile" button on unclaimed /people profiles. No feature
flag is read, so the page no longer calls Amplitude, and the server-only
`AMPLITUDE_EXPERIMENT_DEPLOYMENT_KEY` and `@amplitude/experiment-node-server`
dependency it needed are gone from gp-webapp.

## Context

The panel launched behind `signup-profile-claim-variation`, evaluated per
request for the visitor's Segment anonymous id. Product chose to make the claim
experience the standard one for that entry point rather than run it as a
flagged variation, so the flag added a vendor call, a secret and a failure mode
to every claim visit without changing who sees the panel. The parameter only
picks which panel renders; it grants nothing, so trusting it from the URL is
safe.

## Alternatives rejected

- Keeping the flag at 100%: the same result with an Amplitude call on every
  claim visit and a silent fallback whenever the key or call fails.

## Revisit if

The panel needs to be tested against the original again; then a flag comes
back, likely through a gp-api endpoint if more logged-out flags appear.
