---
title: Background agent runs are pg-boss jobs inside gp-api
status: active
decided_by: [swain]
date: 2026-11-13
code: ['#3835']
scope:
  - packages/gp-api/src/agents/**
  - packages/gp-api/src/jobs/jobs.registry.ts
supersedes: []
superseded_by:
---

# Background agent runs are pg-boss jobs inside gp-api

## Decision

Every agent runs inside gp-api. A background run is a job on one pg-boss
queue, `agentRun`, shared by every agent. `AgentsService.run(name, input)`
is the only way to start one; nothing enqueues to the queue directly. The
queue has one fleet-wide cap (`maxConcurrent` in `jobs.registry.ts`) and no
per-agent cap.

On a deploy the job's abort signal stops the run after its current step,
and `JobsService` requeues it without spending an attempt
(`2026-11-10-shutdown-requeue-waits-until-the-task-is-killed.md`).

## Context

Today a background run crosses gp-api, SQS, a dispatch Lambda, a DynamoDB
job table, a scheduler Lambda and a Fargate task in Python
(`docs/cap-background-agents.md`). gp-api already runs pg-boss
(`2026-11-07-background-jobs-on-pg-boss.md`) with retries, dead letters, a
fleet-wide cap and requeue on shutdown.

## Alternatives rejected

- **Lambda per run.** Its 15-minute limit is shorter than a run (20 to 50
  minutes), and it is a second deploy unit.
- **Keep a Fargate task per run.** A second deploy unit, a second language,
  and the dispatch chain above.
- **Workflow SDK queues (graphile-worker).** A second job queue next to
  pg-boss; see the AI SDK record.
- **A per-agent concurrency setting.** One cap bounds what every agent
  together puts on the tasks and the model provider. Per-agent caps add a
  setting per agent with no case for one yet.

Not rejected, deferred: a worker service of its own for agent runs (the
same image, running only agent workers), once agent load measurably slows
the API.

## Revisit if

Agent runs measurably slow API requests, or job volume puts measurable load
on the gp-api database.
