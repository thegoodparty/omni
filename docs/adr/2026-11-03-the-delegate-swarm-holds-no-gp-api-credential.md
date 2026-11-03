---
title: The Delegate swarm holds no gp-api credential; it reads #tevyn-api and writes one S3 prefix
status: active
decided_by: [tomer-tgp]
date: 2026-11-03
code: ['#TBD']
scope:
  - packages/gp-api/src/authentication/**
  - packages/gp-api/src/outreach/**
  - packages/gp-api/prisma/schema/outreach.prisma
supersedes:
  - 2026-11-02-the-delegate-swarm-is-an-aws-oidc-handoff-agent-caller.md
  - 2026-11-02-managed-panel-waves-hand-off-to-a-swarm-agent.md
superseded_by:
---

# The Delegate swarm holds no gp-api credential; it reads #tevyn-api and writes one S3 prefix

## Decision

The swarm agent never calls gp-api. It finds its work in the `#tevyn-api`
hand-off post, keeps its own state in its own store, and returns Scale to Win
reply exports by uploading them to one S3 prefix. gp-api owns ingest: it
reacts to that upload and runs the same results path staff use.
`OutreachTextHandoff` stays as gp-api's own record of the handler, the mode,
and whether replies have arrived (`queued`, `replies_submitted`). The agent
tier, `AwsOidcService`, `HandoffAgentGuard` and the
`outreach/agent/handoffs` routes are removed.

## Context

Two records on 2026-11-02 gave the swarm an AWS OIDC caller tier on gp-api and
list, claim and report routes with a claim token. Review of that tier (#3531)
objected to a new auth model for one agent, and the Slack post already carries
what the agent needs to start. Everything the claim protocol tracked is state
the agent can hold itself.

## Alternatives rejected

- **AWS OIDC route-bound tier.** A new auth model in `SessionGuard` for a
  single non-human caller, with a route-path boundary to defend. The reviewer
  objected, and an S3 prefix gives the agent a narrower grant.
- **Admin-panel access for the agent.** Too wide: it would reach every staff
  route to do one job.

## Revisit if

The agent needs data that is not in the hand-off post, or a second agent needs
to call gp-api.
