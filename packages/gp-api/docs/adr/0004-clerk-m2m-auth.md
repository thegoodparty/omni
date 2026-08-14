# 0004 — Clerk M2M for service-to-service auth

Status: accepted

## Context

Internal services (people-api, election-api, gp-ai-projects) and trusted automation need to call gp-api without a user JWT. Options:

1. Shared HMAC secret per caller (cheap, no rotation story)
2. Clerk Machine-to-Machine (M2M) tokens (`mt_*` prefix, verified against Clerk's JWKS)
3. Internal-network-only routes (drops cleanly when we add Vercel edge)

## Decision

Use Clerk M2M tokens. Tokens are issued out-of-band in Clerk's dashboard. The `ClerkM2MAuthGuard` runs first in the global guard chain — if the bearer token starts with `mt_`, it's verified via `@clerk/backend` and the request is tagged with `request.m2mToken`.

Routes that should accept M2M-only use `@M2MOnly()`. Routes that accept either an admin user or M2M use `@AdminOrM2MGuard`.

## Consequences

- Caller services don't manage their own keys; rotation goes through Clerk.
- people-api used a separate model (S2S JWT) because it predated this decision. That is moot now: gp-api reaches people-db directly via Prisma and the S2S path is gone, so Clerk M2M is the only machine-auth model left.
- Public routes still need `@PublicAccess()`; the guard chain runs even when no token is present.
