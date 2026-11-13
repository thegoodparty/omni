---
title: Prod gp-api scales out on job wait pressure with step scaling
status: superseded
decided_by: [swain]
date: 2026-11-08
code: ['#3682']
scope:
  - packages/gp-api/src/jobs/**
  - packages/gp-api/deploy/components/service.ts
supersedes: []
superseded_by: 2026-11-09-job-wait-pressure-scales-by-target-tracking.md
---

# Prod gp-api scales out on job wait pressure with step scaling

## Decision

Prod gp-api adds tasks for background jobs on wait pressure: per queue, how
long the oldest job a free worker could start has waited, divided by that
job's `alertAfterWaitingMinutes`, and the highest queue wins. Jobs held
behind their group do not count. Every task publishes it to CloudWatch
(`GpApi/Jobs` `JobWaitPressure`) once a minute. A step-scaling policy adds 2
tasks when it is at least 0.5 for two minutes and 4 when it is at least 1.
It only scales out; CPU and memory target tracking scale back in. This
replaces target tracking on queued jobs per task.

## Context

Jobs wait on Databricks and S3, not CPU, so CPU tracking does not see them
back up. The first policy tracked `QueuedJobs` per running task, target 5.
A count is the wrong unit: 5 waiting 2-hour jobs are a serious backlog and 5
waiting 50ms jobs are nothing. Every job already declares how long it may
wait. AWS's SQS scaling guidance derives the target from acceptable latency
over processing time, and Judoscale and KEDA scale on queue latency or the
oldest message's age. Every queue is pg-boss `key_strict_fifo`, so a job
behind its group's active or retrying job cannot use a new task; pg-boss's
`readyOldestSeconds` counts those, so gp-api computes the age itself.

## Alternatives rejected

- **Jobs per task, target tracking.** The wrong unit across job types: no
  one target fits a 50ms job and a 2-hour one.
- **Target tracking on wait time.** Target tracking assumes the metric falls
  in proportion as tasks are added. Queue depth does; how long the oldest
  job has waited does not.

## Revisit if

Workers move out of the API tasks, or a job type needs scale-in on its own
signal.
