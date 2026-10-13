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
- people-api used a separate model (S2S JWT) because it predated this decision. That is moot now: gp-api reads voter data from Databricks and the S2S path is gone, so Clerk M2M is the only machine-auth model left.
- Public routes still need `@PublicAccess()`; the guard chain runs even when no token is present.

## Update: JWT-format M2M tokens are a read tier

Clerk can also issue M2M tokens as JWTs (`sub` starts with `mch_`). `@clerk/backend` verifies those against the instance JWKS and `exp`/`nbf` only; it does not check scopes or the machine secret, so any machine in the Clerk instance can mint one that verifies. `SessionGuard` therefore tags a verified JWT M2M token as `request.serviceReader`, never `request.m2mToken`, and honours it only on `@PublicAccess()` routes. `ServiceReadGuard` admits it (along with full M2M and admins) on the public person-profile reads that gp-marketing calls server-side; the render gate uses `ServiceReadOrOwnerGuard`, which also admits the owner of the requested `personId`. Opaque `mt_*` tokens keep full M2M as before.
