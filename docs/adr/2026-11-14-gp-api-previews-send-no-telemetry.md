---
title: gp-api preview stacks send no telemetry to Grafana
status: active
decided_by: [swain]
date: 2026-11-14
code: ['#3800']
scope:
  - packages/gp-api/deploy/gp-api-secret-keys.ts
  - packages/gp-api/deploy/index.ts
  - packages/gp-api/src/otel.ts
supersedes: []
superseded_by:
---

# gp-api preview stacks send no telemetry to Grafana

## Decision

A gp-api PR preview gets every `GP_API_DEV` key except
`OTEL_EXPORTER_OTLP_HEADERS`, the Grafana Cloud token. Without it `src/otel.ts`
never starts OpenTelemetry, so a preview sends no logs, metrics, traces or
profiles. Withholding the credential, rather than a runtime flag, means no code
path on a preview can export, whatever later code does. Preview logs stay in
CloudWatch.

## Context

Grafana Cloud bills active metric series. Each preview stack exported a full
copy of gp-api's series under its own `service_instance_id`, which changes on
every deploy, so old series lingered while new ones arrived. Once the pg-boss
jobs framework landed, every preview also exported per-queue job metrics, and
previews accounted for most of gp-api's active series, more than dev and prod
together. Nothing reads preview telemetry: Grafana dashboards and alerts are
created for dev and prod only.

## Alternatives rejected

- Drop preview data at ingest (Grafana Adaptive Metrics or drop rules): it
  still ships the data, depends on Grafana-side config outside this repo, and
  covers metrics only.
- Keep logs and traces on previews and drop only metrics: previews' trace
  spans also feed Grafana's span metrics, and no one reads preview telemetry
  there.
- An env flag in `otel.ts`: a flag can be flipped or bypassed by new code; a
  missing token cannot.

## Revisit if

Someone needs to debug a preview from Grafana regularly. Then give that one
stack the token on purpose, rather than every preview.
