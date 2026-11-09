---
title: Dev gp-api autoscales with prod's policies, from 2 to 6 tasks
status: active
decided_by: [swain]
date: 2026-11-09
code: ['#3687']
scope:
  - packages/gp-api/deploy/components/service.ts
  - packages/gp-api/src/jobs/**
supersedes: []
superseded_by:
---

# Dev gp-api autoscales with prod's policies, from 2 to 6 tasks

## Decision

Dev gp-api autoscales with the same three policies as prod: CPU and memory
target tracking at 50%, and step scale-out on job wait pressure
(`2026-11-08-prod-scales-out-on-job-wait-pressure.md`) read from dev's own
metric. It runs 2 to 6 tasks instead of a fixed 2. Autoscaling owns dev's
task count, so a deploy leaves it alone. Previews stay at one fixed task.

## Context

Job-driven scale-out is new, and we want to see it work before relying on
it in prod. Dev is where we can send it load (`jobsLoadTest`,
`scripts/jobs-load-test.ts`) without paging anyone for real or adding prod
tasks. Dev ran two fixed tasks because one task was a full outage whenever
it died, and autoscaling adds a task only after the saturation it reacts
to, so 2 stays the floor. The cap of 6 is cost: a stuck worker keeps wait
pressure high, and step scaling would otherwise climb to whatever the cap
is. Dev drains a deregistering task for 15 seconds, so a scale-in during
the release train's E2E cuts any request running longer than that.

## Alternatives rejected

- **Keep dev fixed at 2 and test scaling on a preview.** A preview would
  need its own scalable target, policies and alarm, and the preview deploy
  role cannot create them without widening its permissions in ops.
- **Test in prod only.** The first real test would be a real backlog.
- **Dev at prod's bounds (4 to 24).** Dev's traffic needs neither, and a
  stuck worker would run it to 24 tasks.

## Revisit if

Scale-in during the E2E cuts requests often enough to fail runs, or dev's
cost from scaled-out tasks becomes noticeable.
