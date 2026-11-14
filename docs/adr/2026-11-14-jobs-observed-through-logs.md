---
title: The jobs system is alerted on through logs, with one per-queue metric from one task
status: active
decided_by: [swain]
date: 2026-11-14
code: ['#PR']
scope:
  - packages/gp-api/src/jobs/**
  - packages/gp-api/src/observability/otel/**
  - packages/gp-api/deploy/components/alerting/job-alerts.ts
  - packages/gp-api/deploy/components/jobsDashboard.ts
supersedes: []
superseded_by:
---

# The jobs system is alerted on through logs, with one per-queue metric from one task

## Decision

gp-api's job alerts read the `JobsService` log lines: `jobs-dead-letter`
counts `job dead-lettered`, and `jobs-backed-up` counts `job queue backed
up`, which one task logs once a minute per queue past its
`alertAfterWaitingMinutes`. The only per-queue metric is `jobs_wait_pressure`,
exported by that same task: the holder of a Postgres session advisory lock.
pg-boss's OpenTelemetry stays on for its spans, so a job still runs under its
`process <queue>` span linked to the request that sent it, and its five
metrics are dropped with an OTel view on the `pg-boss` meter. The dashboard
reads Grafana's span metrics on those spans.

This replaces the "every queue gets the same metrics" clause of
`2026-11-07-background-jobs-on-pg-boss.md`; the rest of that record stands.

## Context

After November 10 our Grafana metric series grew about twentyfold, mostly
from jobs metrics: series for ~265 queues (each job and its dead-letter queue) multiplied by
every task and every preview, since every task reported the same
database-wide numbers. The largest, pg-boss's operation-duration histogram,
had no reader. The two alerts needed two signals per queue, and a log line
is free when nothing is wrong. CloudWatch `JobWaitPressure`, which
autoscaling reads, is unchanged.

## Alternatives rejected

- **Turn pg-boss's OpenTelemetry off.** Removes the metrics and the spans,
  and with the spans the link from a job to its request.
- **Keep the gauges, reported by every task.** Series grow with task count.
- **Loki recording rules per queue.** Grafana's recording-rule writer only
  accepts one unlabelled series.
- **A pg-boss schedule as the single reporter.** A different task runs each
  minute, so every task's instance id still ends up on the gauge.

## Revisit if

A job needs an alert that a log line cannot express, or Grafana's span
metrics gain the deployment environment as a dimension.
