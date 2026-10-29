---
title: Vercel callers authenticate to gp-api with Vercel OIDC tokens
status: active
decided_by: [swain]
date: 2026-10-29
code: ['#3395']
scope:
  - packages/gp-api/src/authentication/**
  - packages/gp-api/deploy/index.ts
supersedes: []
superseded_by:
---

# Vercel callers authenticate to gp-api with Vercel OIDC tokens

## Decision

Server code on Vercel (gp-marketing, candidate-sites) authenticates its
reads to gp-api with the deployment's default Vercel OIDC token, sent as
`Authorization: Bearer`. gp-api verifies the RS256 signature against Vercel's
JWKS, the issuer (`https://oidc.vercel.com/good-party`, or
`https://oidc.vercel.com` for a project in global issuer mode) and the
audience `https://vercel.com/good-party`, then requires the token's
`project_id:environment` to be in `VERCEL_OIDC_ALLOWED_PROJECTS`, a
non-secret list set per gp-api environment in `deploy/index.ts`. A verified
token is a service reader, the same read-only tier as a JWT-format Clerk M2M
token, and never a full M2M caller. The Clerk JWT stays accepted while the
callers migrate.

## Context

Both sites sent a long-lived Clerk JWT M2M token stored as a Vercel env var.
It expires every 90 days, and the workflow meant to rotate it had never
succeeded, so each expiry was an outage waiting to happen. Vercel already
issues every deployment a short-lived signed token (2h for functions, 1h for
builds) naming its team, project and environment, so no secret has to be
stored or rotated.

## Alternatives rejected

- Keep the Clerk JWT and fix the rotation workflow. Still a stored bearer
  secret with a 90-day cliff, and a moving part that had already failed.
- Mint a Clerk M2M token at request time. Per-isolate minting on Vercel
  tripped Clerk's token-creation limit, which is why the static token existed.
- Allowlist by project name. Names can be renamed; project ids cannot.
- A custom audience per caller. Both callers use the default token, and the
  project id already identifies the caller.

## Revisit if

Both callers have moved to OIDC and no other caller sends a JWT-format Clerk
M2M token; then remove that path. Or a non-Vercel server needs the same
read tier, which would need its own credential.
