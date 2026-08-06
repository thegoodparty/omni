# 0001 — election-api secured by default with Clerk M2M

Status: accepted

> Update (JWT-format M2M tokens): callers now mint **JWT-format** Clerk M2M tokens
> (`tokenFormat: 'jwt'`) instead of opaque `mt_*` tokens, so election-api verifies
> them **networkless** (locally, via the instance's public key) with no per-request
> Clerk API call. gp-api's caller secret was renamed `GP_WEBAPP_MACHINE_SECRET` ->
> `GP_API_MACHINE_SECRET` to match the renamed `gp-api` machine. The guard no longer
> gates on a token prefix (JWTs start with `eyJ`); `clerkClient.m2m.verify` rejects
> anything that isn't a valid M2M token for this machine. Everything else below
> (default-deny, `@PublicAccess()`, observe-only rollout) is unchanged.

## Context

election-api runs behind an internet-facing ALB (`internal: false`, public subnets,
`0.0.0.0/0` ingress) and, until now, required no authentication. That exposed the
full election dataset — and, via `GET /v1/campaign-strategy-context`, candidate PII
(email) — to anyone on the internet.

The only consumers are server-side:

- **gp-api** — three HTTP callers (`elections`, `campaignStrategy`, `electedOffice`).
- **gp-marketing** — server components + sitemap/validation build scripts. All reads
  run server-side; candidate images are served from a third-party CDN
  (`assets.civicengine.com`), not election-api, so no browser calls election-api directly.
- **ALB health check** — `GET /v1/health`, cannot present a bearer token.

Because no browser or public client talks to election-api directly, we can require
authentication on every route except the health check.

## Decision

Secure election-api by default with Clerk Machine-to-Machine (M2M) tokens, matching
the pattern gp-api already uses as a recipient (see gp-api ADR 0004).

- A global `M2MAuthGuard` (`APP_GUARD`) is default-deny: it verifies a JWT-format M2M
  bearer token against `ELECTION_API_MACHINE_SECRET` via `@clerk/backend`
  (`clerkClient.m2m.verify`, networkless for JWTs). Routes opt out with
  `@PublicAccess()` — only the health check does.
- Callers mint tokens with their **own** machine secret (gp-api:
  `GP_API_MACHINE_SECRET`, gp-marketing: `GP_MARKETING_MACHINE_SECRET`) using
  `tokenFormat: 'jwt'`, cached and renewed before expiry, and send
  `Authorization: Bearer eyJ...`. Each caller machine is connected to the election-api
  machine in the Clerk dashboard.
- Enforcement is gated by `ELECTION_API_AUTH_ENFORCED`. While it is not `'true'` the
  guard runs in **observe-only** mode: it verifies and logs what it would reject but
  lets the request through. This lets us deploy consumers (sending tokens) and the
  guard first, confirm every real caller authenticates, then flip enforcement on.
- Swagger (`/api`) is only mounted outside production so the schema is not exposed
  publicly.

## Consequences

- election-api is no longer a public read-only API; the internet-facing ALB is fine
  because the app rejects unauthenticated traffic once enforcement is on.
- Rotation goes through Clerk; no per-caller keys are managed in election-api.
- New consumers must have their machine connected to election-api in Clerk and mint
  tokens with their own secret.
- Rollout order matters: ship callers + observe-only guard first, verify token logs,
  then set `ELECTION_API_AUTH_ENFORCED=true` per env (dev → qa → prod). Rollback is
  flipping the flag back to `false`.
