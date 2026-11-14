---
title: vercel-config drives settings the provider cannot hold safely through the Vercel CLI
status: active
decided_by: [swain]
date: 2026-11-14
code: ['#3824']
scope:
  - packages/vercel-config/index.ts
  - packages/vercel-config/infra-cli.ts
supersedes: []
superseded_by:
---

# vercel-config drives settings the provider cannot hold safely through the Vercel CLI

## Decision

When a Vercel setting has no `@pulumiverse/vercel` resource, or its resource
would store a secret in state, `packages/vercel-config` sets it by running a
pinned Vercel CLI (`npx -y vercel@<version>`) from a `@pulumi/command`
`local.Command`. The command string holds the desired value, so it runs on
create and again, as its `update`, only when that value changes. The CLI
reads `VERCEL_TOKEN` from the environment `infra-cli.ts` runs Pulumi in,
never from the command's `environment` input, so the token is not in state.
Each command must be safe to rerun. The first two are the team default
deployment protection (`vercel api` PATCH of `/v2/teams/<teamId>`, with
`--silent`) and per-project Observability Plus
(`vercel project observability enable|disable`).

## Context

`vercel.TeamConfig` reads the whole team into state, including the team invite
code, and the apply token is an Owner, so it sees the code. The PR diff role
can read and decrypt the stack's state, so `docs/secrets.md` rules that out.
The provider has no resource for Observability Plus inclusion. The CLI covers
both, so the stack carries no REST client of its own.

## Alternatives rejected

- **`vercel.TeamConfig`.** Puts the invite code in state.
- **Pulumi dynamic resources calling the REST API.** Our own client code to
  own and test, for what the CLI already does.
- **Leave both in the dashboard.** The settings that decide who can open a new
  project's deployments and which projects can alert stay unreviewed.

## Revisit if

The provider gains an Observability Plus resource, or `TeamConfig` stops
reading the invite code into state.
