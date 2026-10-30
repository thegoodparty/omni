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
  - packages/gp-ai/infrastructure/modules/serve-analyze-fargate/main.tf
  - packages/gp-ai/infrastructure/shared/slack-notifier/main.tf
supersedes: []
superseded_by:
---

# Omni runs on Node 24, one major for every package

## Decision

Every TypeScript package, CI job, Vercel project, the gp-api container and
the gp-ai Lambdas (`nodejs24.x`) run Node 24. `.nvmrc` holds the exact patch (`24.22.2`), and the gp-api
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

The release train applies the `serve-analyze-trigger` runtime with the
serve-analyze-fargate roots. `shared-slack-notifier` is not in CI, so after
merge someone applies it by hand from the repo root:

```bash
cd packages/gp-ai/infrastructure/modules/serve-analyze-fargate/slack-notifier
npm install && npm run package
cp slack-notifier.zip ../../../shared/slack-notifier/
cd ../../../shared/slack-notifier
terraform init
terraform plan -var environment=prod -out=tfplan
terraform apply tfplan
```

The plan should change only `runtime`, plus `source_code_hash` if the zip
differs from the last one applied.

## Revisit if

Node 26 becomes active LTS, or a dependency we cannot replace drops Node 24.
