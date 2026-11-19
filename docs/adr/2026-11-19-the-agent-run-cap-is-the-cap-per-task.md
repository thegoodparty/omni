---
title: The agentRun cap is the only limit, so a task gets as many slots as the cap
status: active
decided_by: [swain]
date: 2026-11-19
code: []
scope:
  - packages/gp-api/src/jobs/jobs.registry.ts
  - packages/gp-api/deploy/components/service.ts
supersedes: []
superseded_by:
---

# The agentRun cap is the only limit, so a task gets as many slots as the cap

## Decision

`agentRun` runs at most 100 runs at once fleet-wide, and a task carries 100
slots, so the fleet-wide cap alone decides how many runs go at once. No task
count is part of the limit: a queue's per-task `concurrency` is there to
spread work over the tasks autoscaling adds, and this queue does not want to
be spread.

## Context

Every background agent shares this one queue
(`2026-11-13-agent-runs-are-pg-boss-jobs-in-gp-api.md`). At 2 a task and a
cap of 10, migrating an agent dropped its capacity tenfold: the PMF Engine it
migrates from runs `/pmf-engine/dev/max-concurrent-agents` = 100, and a judge
sweep is 42 runs for one suite — queued ten at a time, that is 10 to 18
minutes of waiting before any of them starts.

A run is 20 to 50 minutes of waiting on a model provider, so nobody in the
middle of the path is scarce: the tasks are idle and no connection is held
for a running job (pg-boss borrows one to fetch and again to complete), so
however many slots a task has, they do not pin that many connections. The
scarce things are the provider's rate limit and the spend behind it, and
both are counted in runs running, which is exactly what one cap counts.

Where it costs something is that a task can now be handed all 100 runs, so
100 model loops can land on one task's heap. Previews and prod carry 4096 MB
and dev 2048 MB (`deploy/components/service.ts`). A loop holds its
conversation in memory — up to 120 steps of a reply of up to 64k output
tokens — so this is the number to watch before raising the cap further.

The queue also stops showing claimable backlog: a job the cap holds back is
not backlog a new task could start, so wait pressure leaves it out and the
fleet does not scale out for it. That is intended — the cap is the limit, so
more tasks would not run more runs.

## Alternatives rejected

- **`concurrency` unset or 1 with the cap at 100.** A task runs one run at a
  time, so 100 runs need 100 tasks that autoscaling will never add: the cap
  becomes unreachable and the queue is slower than what it replaces.
- **`maxConcurrent` alone and a per-task value derived from the task count.**
  Every per-task value below the cap is a number whose only job is to
  serialize work the cap already serializes.
- **No cap, per-task concurrency only.** Nothing then bounds runs fleet-wide
  under autoscaling, so the provider's limit is the only throttle and a burst
  spends against it until calls fail.

## Revisit if

A task OOMs under agent load, a run's model calls start failing on a rate
limit, or a run measurably slows API requests on its task.
