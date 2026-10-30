---
title: Omni runs on Node 24, one major for every package
status: active
decided_by: [swain]
date: 2026-10-29
code: ['#3431']
scope:
  - .nvmrc
  - package.json
  - packages/*/package.json
  - packages/gp-api/deploy/Dockerfile
  - packages/gp-ai/autopilot/Dockerfile
  - packages/gp-ai/pmf_engine/Dockerfile
  - .github/actions/setup-node-workspace/**
supersedes: []
superseded_by:
---

# Omni runs on Node 24, one major for every package

## Decision

Every TypeScript package, CI job, Vercel project and the gp-api container
runs Node 24. `.nvmrc` holds the exact patch (`24.22.2`), and the gp-api
Dockerfile uses the same tag. Every `engines.node` says `24` or `24.x`, and
`@types/node` is `^24`. The packages move together because the contracts
guard (`packages/contracts/scripts/assert-node-version.ts`) fails any test run
whose major differs from `.nvmrc`, and `engine-strict=true` fails `npm ci`
when an `engines` field disagrees.

## Context

Node 22 leaves maintenance in April 2027. In the gp-api test-speed spike,
Node 24 cut each Nest test boot by 13 to 17%, cut GC time per boot from about
17ms to 6ms, and cut module import time by about 10%. The full gp-api suite
passed on 24 with no code changes. No third-party package's `engines`
excluded 24. Only our own five `engines` fields did. Node 24 enforces OpenSSL
security level 2 (it rejects RSA keys under 2048 bits). Every vendor host
gp-api calls completed a handshake on 24 before the switch.

## Alternatives rejected

- **Stay on 22 until April 2027.** We would pay the slower boots on every CI
  run in the meantime and do the same upgrade later anyway.
- **Move packages one at a time.** The guard and `engine-strict` make a split
  repo fail its own tests and installs. Allowing two majors would mean
  weakening the guard, which exists because test results on the wrong major
  were mistaken for pre-existing breakage.
- **Pin `.nvmrc` to the major only (`24`).** Local and CI could then drift
  from the patch the container runs. Dependabot's base-image PRs already
  bump the exact patch.

## Follow-up

The gp-ai Lambdas `serve-analyze-trigger` and `shared-slack-notifier` stay on
`nodejs22.x`. gp-ai Terraform pins `hashicorp/aws ~> 5.0` (5.100.0), which
rejects `nodejs24.x`. Moving them needs the AWS provider v6 upgrade across the
gp-ai roots, and it must land before AWS deprecates `nodejs22.x` (around April
2027).

## Revisit if

Node 26 becomes active LTS, or a dependency we cannot replace drops Node 24.
