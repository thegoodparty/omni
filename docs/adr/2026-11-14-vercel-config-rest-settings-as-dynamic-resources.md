---
title: vercel-config drives settings the provider cannot hold safely through dynamic resources
status: active
decided_by: [agent]
date: 2026-11-14
code: ['#3824']
scope:
  - packages/vercel-config/rest-resources.ts
  - packages/vercel-config/index.ts
supersedes: []
superseded_by:
---

# vercel-config drives settings the provider cannot hold safely through dynamic resources

## Decision

When a Vercel setting has no `@pulumiverse/vercel` resource, or its resource
would store a secret in state, `packages/vercel-config` manages it with a
Pulumi dynamic resource in `rest-resources.ts` that calls the REST API. Each
stores only the fields it manages, reads `VERCEL_API_TOKEN` from the
environment when a call runs, and adopts in `create`: it reads the live value
and writes only when it differs. The first two are the team default
deployment protection and per-project Observability Plus inclusion.

## Context

`vercel.TeamConfig` reads the whole team into state, including the team invite
code, and the apply token is an Owner, so it sees the code. The PR diff role
can read and decrypt the stack's state, so `docs/secrets.md` rules that out.
The provider has no resource for Observability Plus inclusion. Dynamic
resources cannot be imported in Pulumi's Node.js runtime, hence the adopting
`create`.

## Alternatives rejected

- **`vercel.TeamConfig`.** Puts the invite code in state.
- **`@pulumi/command` with `curl`.** No import or read either, a create that
  always writes, and the token would have to reach the command without
  landing in its recorded inputs.
- **Leave both in the dashboard.** The settings that decide who can open a new
  project's deployments and which projects can alert stay unreviewed.

## Revisit if

The provider gains an Observability Plus resource, or `TeamConfig` stops
reading the invite code into state.
