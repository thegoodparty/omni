---
title: Public read routes that only our servers call require a service read token
status: active
decided_by: [swain]
date: 2026-10-29
code: ['#3382']
scope:
  - packages/gp-api/src/personProfiles/controllers/public-person-profiles.controller.ts
  - packages/gp-api/src/campaigns/controllers/public-campaigns.controller.ts
  - packages/gp-api/src/websites/controllers/websites.controller.ts
supersedes: []
superseded_by:
---

# Public read routes that only our servers call require a service read token

## Decision

`GET /v1/public-person-profiles/voter-density`, `GET /v1/public-campaigns`,
`GET /v1/websites/:vanityPath/view` and `GET /v1/websites/by-domain/:domain`
stay `@PublicAccess()` but are gated by `ServiceReadGuard`: a service-reader
token, an `mt_*` M2M token, or an admin. Callers present a Vercel OIDC token
([Vercel callers authenticate with OIDC](2026-10-29-vercel-callers-authenticate-with-oidc.md)).
Anonymous and ordinary signed-in callers get a 403. The per-IP rate limit on voter-density is
removed.

## Context

The only callers are our own servers: gp-marketing renders the person pages
(voter-density, public-campaigns) and candidate-sites renders the candidate
sites (the two websites reads), both server-side. Leaving the routes anonymous
added nothing for them and let anyone scrape the same data straight from
api.goodparty.org. The per-IP limit on voter-density never limited visitors,
because every request arrived from a Vercel server address.

`@PublicAccess()` stays because `SessionGuard` only lets a service-reader
token (Vercel or GitHub OIDC) through on public routes; it sets
`serviceReader` and `ServiceReadGuard` decides from there.

## Alternatives rejected

- Keep the routes anonymous behind per-IP limits. The limit keys on the
  caller's address, which is a Vercel server for every legitimate request, so
  it either throttles real traffic or limits nothing.
- An edge (WAF) rate limit. Same keying problem for server-side callers, and
  it still leaves the data readable by anyone under the limit.
- `M2MOnly`. It rejects service-reader tokens, which is what both callers
  send.

## Revisit if

A browser starts calling one of these routes directly. A browser cannot hold
the token, so that route would need its own public, separately limited read.
