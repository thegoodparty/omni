---
title: gp-api evaluates Amplitude flags through its own gp-api server deployment
status: active
decided_by: [swain]
date: 2026-11-04
code: ['#PR_NUMBER']
scope:
  - packages/gp-api/src/features/**
  - packages/gp-api/src/shared/env/env.schema.ts
  - packages/gp-api/deploy/gp-api-secret-keys.ts
supersedes: []
superseded_by:
---

# gp-api evaluates Amplitude flags through its own gp-api server deployment

## Decision

gp-api evaluates Amplitude Experiment flags with the `server-` key of a
dedicated deployment named `gp-api` in each Amplitude project, read from
`AMPLITUDE_EXPERIMENT_DEPLOYMENT_KEY`. It never uses the Project API Key.
That way a flag created through the Management API, the Amplitude MCP or the
`amp` CLI serves in gp-api once the `gp-api` deployment is attached to it,
with no step in the Amplitude UI.

## Context

gp-api called `Experiment.initializeRemote` with the analytics Project API
Key. Amplitude treats that key as a hidden "Project API Key" deployment that
the Management API, the MCP and the CLI cannot attach to a flag. Agents create
flags through those tools (`.claude/skills/amplitude-flag/`), so their flags
never served in gp-api until someone attached them by hand in the UI, and a
flag gp-api could not evaluate read off. The `gp-api` deployments exist in
both projects and are attached to every active flag.

## Alternatives rejected

- Keep the Project API Key and attach each new flag in the UI: a manual step
  that agents cannot do, and a missed one silently reads off in gp-api.
- Read the new key with a fallback to the Project API Key: a deploy with the
  new key missing would quietly evaluate through the deployment flags cannot
  be attached to.
