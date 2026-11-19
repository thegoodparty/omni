---
title: The universal judge reaches agents only through a base URL
status: active
decided_by: [swain]
date: 2026-11-19
code: []
scope:
  - packages/gp-api/src/agents/agentRunRoutes.controller.ts
  - packages/gp-api/src/agents/agentRunRoutes.service.ts
  - packages/gp-api/src/agents/agentRunRoutes.module.ts
  - packages/gp-api/src/agentExperiments/services/experimentRuns.service.ts
  - packages/gp-api/deploy/agentsOnGpApi.ts
supersedes: []
superseded_by:
---

# The universal judge reaches agents only through a base URL

## Decision

The judge imports no gp-api code and holds no AWS, S3, SQS or Databricks
access. It holds two URLs and a way to sign a user in, and an agent is reached
over HTTP alone:

```
POST /agents/:name/runs   { input }  -> { runId }
GET  /agents/runs/:runId             -> { status, artifact, error }
```

Both are mounted in dev and previews only, 404 elsewhere. `POST` dispatches
through the product's own per-agent switch (`runsOnGpApi`): gp-api's agents
when it is on, the PMF Engine otherwise. `GET` reads `AgentRun` or
`ExperimentRun` and returns the artifact the same way for both, so the judge
never learns which engine ran the agent and never touches S3.

A suite writes its input once, in the shape every agent has: its manifest's,
whose fields are snake_case. The route converts to gp-api's camelCase naming
when it dispatches to gp-api, and fills `today` when the definition requires
it. That conversion is the only place the two engines' vocabularies meet, and
it is deleted with the PMF Engine at teardown.

## Context

The judge used to run an arm in-process: it imported `AgentsService`, patched
a provider to observe turns, and read `AgentRun` rows out of the same database.
That works only while both arms are one process. A judge arm is now a deployed
gp-api — dev for the base arm, a PR preview for the candidate — so an
in-process patch observes nothing, and the arm's S3/SQS/warehouse access would
have to be duplicated in the judge.

A background agent is a paid run with real side effects, so the route is
gated to dev and previews and refuses `compliance_setup` by name (it buys
domains and submits to Peerly). Previews name every agent in the registry in
`AGENTS_ON_GP_API`, so the candidate arm runs gp-api's engine for the agent a
migration PR is moving.

## Alternatives rejected

- **In-process import in the judge.** The arm is another process, so this
  could only work by keeping the judge pinned to a checkout of the branch under
  test, which is the page-replay and worktree machinery this replaces.
- **The judge talks to S3 and the database directly.** Duplicates gp-api's
  read path in a second codebase, and hands a test harness the AWS access the
  framework exists to avoid.
- **A judge-only agent route that bypasses `runsOnGpApi`.** The judge would
  then decide which engine an agent runs on, and a migration PR could not
  compare the two engines on one input.

## Revisit if

The judge ever needs an agent's message transcript rather than its artifact;
that is a second read route, not a reason to import gp-api.
