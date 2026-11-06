---
title: gp-webapp front-end observability lives in Grafana Cloud, not Sentry
status: active
decided_by: [swain]
date: 2026-11-06
code: ['#3667']
scope:
  - packages/gp-webapp/instrumentation-client.ts
  - packages/gp-webapp/instrumentation.ts
  - packages/gp-webapp/app/shared/sentry.tsx
  - packages/gp-webapp/app/shared/observability/**
  - packages/gp-webapp/app/fx/**
  - packages/gp-webapp/scripts/upload-faro-sourcemaps.mjs
  - packages/gp-api/deploy/components/alerting/frontend-error-alerts.ts
supersedes: []
superseded_by:
---

# gp-webapp front-end observability lives in Grafana Cloud, not Sentry

## Decision

gp-webapp's browser errors, RUM and session replay go to Grafana Cloud
Frontend Observability through the Faro Web SDK, one Frontend Observability app per environment, and
its server-side request errors go to Grafana Cloud Loki over OTLP. Alerts on
them are Grafana rules provisioned with the rest of gp-api's alerting, prod
only, routed through the existing notification policy. Sentry is removed once
this is in place. The reason is one place for all observability: backend logs,
metrics, traces and alerting are already in Grafana, and Sentry had no human
use in the 90 days before this decision and no error alerts at all.

## Context

The useful front-end signal in the 2026-11-04 incident was an existing error
("Connection closed") suddenly reaching 3 users on /dashboard/priorities
inside 90 seconds. Nothing alerted on it, and nobody was reading Sentry. Its
environment was never set either, so dev, PR previews, E2E runs and
production all reported as "production". Prod volume is low, about 85 issues
a month, most of them network failures and browser-extension noise.

## Alternatives rejected

- **Keep Sentry and add alert rules there.** A second alerting system beside
  Grafana, with its own routing and its own on-call path into Delegate, for a
  tool nobody opened.
- **Both, permanently.** Two places to look for every front-end incident, and
  the second one is the one people forget.
- **Faro straight to the Grafana collector, no relay.** Ad blockers block
  `faro-collector-*.grafana.net` by hostname, so the `/fx` same-origin relay
  stays.

## Revisit if

Grafana Frontend Observability stops grouping errors well enough to alert on,
or session-based pricing outgrows what the signal is worth.
