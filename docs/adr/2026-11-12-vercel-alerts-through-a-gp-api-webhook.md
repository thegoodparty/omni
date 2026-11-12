---
title: Vercel alerts reach the Bugs board through a signed gp-api webhook and a Grafana rule
status: active
decided_by: [agent]
date: 2026-11-12
code: ['#3766']
scope:
  - packages/gp-api/src/vendors/vercel/webhooks/**
  - packages/gp-api/deploy/components/alerts.ts
supersedes: []
superseded_by:
---

# Vercel alerts reach the Bugs board through a signed gp-api webhook and a Grafana rule

## Decision

Vercel Spend Management (`budget.reached`) and Observability
(`alerts.triggered`, `firewall.attack`) webhooks post to gp-api
`POST /v1/webhooks/vercel`. gp-api verifies `x-vercel-signature` (HMAC-SHA1 of
the raw body), logs one line and adds to `vercel_alert.count`. The prod
`vercel-alert` Grafana rule fires on any increase and reaches Delegate through
the existing `dev-alerts` route, like every other operational alert. The
counter's labels are only `vercel_event` and `threshold_percent`, seeded with
zeros at boot, because `increase()` misses the first sample of a new series;
the project goes in the log line.

## Context

Budget alerts only reached owner email, and a spend spike went unseen until
Vercel's account manager wrote to us. Grafana rules into Delegate are already
how operational errors become tickets.

## Alternatives rejected

- **Vercel's Slack app.** Delegate acts only on @mentions, and operational
  errors are alerts, not Slack posts.
- **A log or metrics drain into Grafana.** Billed per GB and more work, for
  alerts Vercel already computes.
- **Posting straight into Delegate.** The bridge for that was never merged.

## Revisit if

Vercel adds a native Grafana or alertmanager destination, or we want our own
rules over Vercel traffic rather than Vercel's.
