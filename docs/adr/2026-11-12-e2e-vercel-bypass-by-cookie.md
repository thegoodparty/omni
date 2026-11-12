---
title: E2E gets past Vercel Authentication with the bypass cookie, not a browser header
status: active
decided_by: [agent]
date: 2026-11-12
code: ['#3765']
scope:
  - packages/gp-webapp/e2e-tests/global-setup.ts
  - packages/gp-webapp/e2e-tests/playwright.config.ts
  - packages/gp-webapp/e2e-tests/src/helpers/vercelBypass.helper.ts
---

# E2E gets past Vercel Authentication with the bypass cookie, not a browser header

## Decision

Playwright global setup sends `VERCEL_AUTOMATION_BYPASS_SECRET` once, to a
static file on the webapp, with `x-vercel-set-bypass-cookie`. It saves the
cookie Vercel sets as the config's `storageState`, so every browser and request
context starts with it. Node clients of the webapp's `/api` proxy send
`x-vercel-protection-bypass` directly. The browser never sends the header, and
with the secret unset nothing changes.

## Context

gp-webapp previews, including `dev.goodparty.org`, are behind Vercel
Authentication after bots scraped them and drove spend up about 4x. The PR
E2E and the release train E2E both run against those deployments. The browser
also calls gp-api, Clerk and Stripe cross-origin.

## Alternatives rejected

- `extraHTTPHeaders`, as Vercel's docs suggest. Playwright adds it to every
  request, so each cross-origin call gets a CORS preflight for an unknown
  header, and the secret goes to third parties.
- A context `route` that adds the header for the webapp host. Routing turns
  off the HTTP cache. It also needs every spec to import a custom `test`.
  Any `page.route` that calls `route.continue()` skips it.

## Revisit if

Vercel's bypass cookie expires within a single shard's run.
