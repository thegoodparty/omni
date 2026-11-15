---
title: A resumed agent run whose agent changed shape is superseded and started over
status: active
decided_by: [swain]
date: 2026-11-15
code: ['#3828', '#3812', '#3798']
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

On every attempt: the same hash continues from the saved steps. A different
hash on a run stamped by a task that booted after this one means this task
runs older code, so it hands the job back. Otherwise the run is marked
superseded, keeps its steps and cost, and a fresh run with the same input
is created, linked from it and queued. Callers holding a run id follow the
link. There are no agent versions (v1, v2).

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
- **Pin each run to its deployment, as Vercel's Workflow SDK does on
  Vercel.** Needs old code still running; ECS does not keep it.

## Revisit if

Restarts get expensive. With subagents, a resume could keep the finished
subagent results whose name and output schema did not change.
