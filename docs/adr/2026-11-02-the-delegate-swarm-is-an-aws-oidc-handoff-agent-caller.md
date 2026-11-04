---
title: The Delegate swarm is an AWS OIDC hand-off agent caller, limited to the hand-off routes
status: superseded
decided_by: [tomer-tgp]
date: 2026-11-02
code: ['#3529']
scope:
  - packages/gp-api/src/authentication/**
  - packages/gp-api/deploy/index.ts
supersedes: []
superseded_by: 2026-11-03-the-delegate-swarm-holds-no-gp-api-credential.md
---

# The Delegate swarm is an AWS OIDC hand-off agent caller, limited to the hand-off routes

## Decision

The Delegate agent swarm authenticates to gp-api with the JWT AWS STS signs for
its host role (`sts:GetWebIdentityToken`, audience `gp-api`), not a stored
Clerk machine secret. gp-api checks the account's issuer (`AWS_OIDC_ISSUER`)
and its JWKS, audience `gp-api`, ES384 or RS256, and that `sub`, the role ARN,
is in `AWS_OIDC_HANDOFF_AGENT_ROLES` (the `delegate-swarm-host` role). A match
is a hand-off agent: `request.handoffAgent`, never `m2mToken` or
`serviceReader`. The tier passes only controllers under
`outreach/agent/handoffs` that carry `HandoffAgentGuard`, which accepts it or a
full M2M token; every other route answers 401, even a public one. Either variable
empty turns the path off.

This extends `2026-10-29-gp-admin-is-a-vercel-oidc-machine-caller.md`: a
third platform issuer on the same rule (machine callers send the token their
platform signs, no stored secret), with a tier narrower than service reader.
It changes nothing in the Vercel or GitHub paths or their allowlists.

## Context

The swarm runs on EC2 under `delegate-swarm-host`. Any worker on that host can
mint the token, and swarm config secrets are readable by any script an agent
runs, so a full M2M caller would hand every such script admin-level access. A
route-bound tier keeps the blast radius to the hand-off routes. AWS outbound
identity federation gives the token without a stored secret. The issuer is
account-specific and its value is set by the ops task (ENG-11554), so it is
env config, not code.

## Alternatives rejected

- A Clerk M2M machine for the swarm. A long-lived secret on a host whose
  workers can read it, and full M2M privilege.
- Treat the AWS token as a service reader. Service readers are for public
  reads and are trusted by `ServiceReadGuard` on other routes; the swarm
  should reach none of them.
- Enforce the route limit only in `HandoffAgentGuard`. A guard put on the
  wrong controller would then widen the tier; `SessionGuard` refuses the
  token off the hand-off prefix before any route guard runs.

## Revisit if

The swarm needs a route outside the hand-off prefix, or the host moves off AWS.
