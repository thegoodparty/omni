---
title: gp-api tracks job wait pressure with target tracking, not step scaling
status: active
decided_by: [swain]
date: 2026-11-09
code: []
scope:
  - packages/gp-api/src/jobs/**
  - packages/gp-api/deploy/components/service.ts
supersedes: [2026-11-08-prod-scales-out-on-job-wait-pressure.md]
superseded_by:
---

# gp-api tracks job wait pressure with target tracking, not step scaling

## Decision

Dev and prod gp-api scale on job wait pressure (`GpApi/Jobs`
`JobWaitPressure`, the highest queue's oldest claimable wait over its
`alertAfterWaitingMinutes`, defined in `src/jobs/AGENTS.md` § Scaling)
with a target-tracking policy at 0.5, next to the CPU and memory policies,
with scale-in enabled. 0.5 adds tasks before a job has used half its
allowed wait. Being a target-tracking policy gives it a vote on scale-in:
while jobs still wait, CPU and memory cannot remove tasks.

## Context

A dev load test of the step policy showed it fighting CPU and memory
target tracking: desired count went 6, 5, 6, 5. AWS Application Auto
Scaling scales out if any target-tracking policy wants to, but scales in
only when all target-tracking policies with scale-in enabled agree. Step
policies get no vote, and a scale-out during a scale-in cooldown ends that
cooldown. Jobs wait on Databricks and S3, so during a backlog CPU and
memory read idle and kept removing the task the step policy had just
added. AWS's guide
(https://docs.aws.amazon.com/autoscaling/application/userguide/target-tracking-scaling-policy-overview.html,
"Multiple scaling policies") cautions against mixing the two for this
reason.

Wait pressure is 0 most of the time, which target tracking reads as ready
to scale in, so CPU and memory still decide scale-in when nothing waits.
Target tracking needs data points: every dev and prod task publishes the
metric once a minute, and with no data the policy's alarms go
`INSUFFICIENT_DATA` and it does not act.

The trade-off: target tracking assumes the metric falls in proportion to
capacity, and wait time does not, so a burst can overshoot to the cap
(24 prod, 6 dev). The step policy did the same.

## Alternatives rejected

- **Keep step scaling.** It has no scale-in vote, so CPU and memory remove
  what it adds.
- **Disable CPU and memory scale-in and scale in by step.** More custom
  machinery to tune and keep right, for the same result.

## Revisit if

Bursts overshoot enough to cost money. Then switch the metric to one that
is proportional to capacity, such as estimated time to drain the backlog
(ready jobs x average run time / tasks).
