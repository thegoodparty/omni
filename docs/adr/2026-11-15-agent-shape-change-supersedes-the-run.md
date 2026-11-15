---
title: A resumed agent run whose agent changed shape is superseded and started over
status: active
decided_by: [swain]
date: 2026-11-15
code: ['#3835']
scope:
  - packages/gp-api/src/agents/**
supersedes: []
superseded_by:
---

# A resumed agent run whose agent changed shape is superseded and started over

## Decision

Background agents only. When a run starts, it is stamped with a hash of its
agent's shape: today the output schema; once subagents exist, also their
names and output schemas. Prompts, tools and models are not in the hash. They
change freely, and a run in flight carries on under the new ones.

The hash is `ExperimentRun.shapeHash`. On every attempt: the same hash
continues from the saved steps. A different hash marks the run
`SUPERSEDED`, keeping its steps and cost, and creates and queues a fresh
run with the same input. There are no agent versions (v1, v2).

## Context

Every push to main deploys gp-api, and for a few minutes old and new tasks
both run. A run can start on one release and resume on the next. Saved
steps written toward an old output schema may not produce output that
passes the new one. Pinning a run to the code that started it is not
possible: once ECS replaces the tasks, the old code is gone. #3828's kill
test changed the briefing schema mid-run and the run started over as
described.

## Alternatives rejected

- **Agent versions side by side.** Every shape change becomes two
  definitions to keep and later delete. Shape changes are rare and a
  restart costs at most one run.
- **Resume regardless of shape.** A run could end with output for the old
  schema, failing at the end or writing a wrong artifact.
- **Hash prompts, tools and models too.** Every prompt tweak would restart
  every run in flight.
- **An older task hands back a run stamped by newer code (#3828).** It
  needs a column for when the stamping task booted. Without it, during the
  few minutes of a rollout that changed a shape, an old task can supersede
  a run newer code started, and a new task supersedes the replacement:
  a few wasted steps, once.
- **Pin each run to its deployment, as Vercel's Workflow SDK does on
  Vercel.** Needs old code still running; ECS does not keep it.

## Revisit if

Restarts get expensive. With subagents, a resume could keep the finished
subagent results whose name and output schema did not change.
