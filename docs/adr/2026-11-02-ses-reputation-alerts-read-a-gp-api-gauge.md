---
title: SES reputation alerts read a gauge gp-api exports, not CloudWatch through Grafana
status: proposed # alternative to the grafana-cloudwatch-read role in thegoodparty/ops; only one lands
decided_by: [agent]
date: 2026-11-02
code: ['#3496']
scope:
  - packages/gp-api/src/emailOutreach/services/sesReputationReport.service.ts
  - packages/gp-api/src/emailOutreach/util/sesReputation.metrics.ts
  - packages/gp-api/deploy/components/alerting/ses-reputation-alerts.ts
supersedes: []
superseded_by:
---

# SES reputation alerts read a gauge gp-api exports, not CloudWatch through Grafana

## Decision

gp-api reads the SES account's `Reputation.BounceRate` and
`Reputation.ComplaintRate` from CloudWatch every 5 minutes on every prod task
and exports the newest datapoint from the last 3 hours as the
`ses_account_bounce_rate` and `ses_account_complaint_rate` gauges. The
`ses-bounce-rate` and `ses-complaint-rate` Grafana rules read those gauges
from Prometheus, with the same names, thresholds, window, `for` and messages
as before.

Every task reads, with no `CronLockService` claim, because each task exports
its own series (`service.instance.id`). A task that skipped the read would
keep exporting an older reading and `max()` would page on it. The read writes
nothing, so the cost is a GetMetricData call per task per 5 minutes.

Missing data: a rate with no datapoint in 3 hours stops being exported, which
the rules see as no data (OK), as the CloudWatch query did. A failed read keeps
the last reading, and the rule's `last_over_time(...[15m])` carries it across a
deploy or a missed read, as `execErrState: KeepLast` did.

## Context

The rules used Grafana's `aws-cloudwatch-prod` data source, which assumes the
`grafana-cloudwatch-read` IAM role. That role does not exist, so the rules
could never fire. The gp-api task role already has `cloudwatch:GetMetricData`
for the email auto-pause check.

## Alternatives rejected

- Create `grafana-cloudwatch-read` in thegoodparty/ops. Pending a team
  decision; if chosen, this record and its PR are dropped.
- One task reads under a cron claim. Other tasks' series would go stale and
  keep exporting old readings.
- A structured log line read by a Loki rule. Loki rules bill by bytes read,
  and the existing gauge-backed rules show the cheaper path.

## Revisit if

The `grafana-cloudwatch-read` role is created, or gp-api stops exporting
per-task metric series.
