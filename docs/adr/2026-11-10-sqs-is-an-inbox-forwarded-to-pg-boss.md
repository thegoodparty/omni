---
title: SQS is an inbox from other systems; every inbox message is forwarded to a pg-boss job
status: active
decided_by: [swain]
date: 2026-11-10
code: ['#PR']
scope:
  - packages/gp-api/src/queue/**
  - packages/gp-api/src/jobs/jobs.registry.ts
supersedes: []
superseded_by:
---

# SQS is an inbox from other systems; every inbox message is forwarded to a pg-boss job

## Decision

The gp-api SQS queue stays only for messages other systems send: the polls
pipeline (`pollAnalysisComplete`, `feedbackSynthesisComplete`), EventBridge
(`panelRepliesUploaded`) and gp-ai (`campaignPlanComplete`,
`agentExperimentResult`). For each, the consumer checks the message, sends its
data to the pg-boss job of the same name, keyed by the SQS `MessageId` and
grouped as the sender groups it, and acks. The work runs as that job's worker,
so inbox work gets the job system's retries, dead letters, alerts, dashboard,
tests and autoscaling. The `QueueType` values stay: they are the contract with
the senders, which do not change.

## Context

Other systems already write to this queue, and moving them would change gp-ai,
EventBridge rules and the polls pipeline. Handlers run inside the SQS consumer
could not be tested at the edge (the consumer does not load in tests), had no
dead-letter alert of their own, and did not count toward job wait pressure.

## Alternatives rejected

- **Senders write to pg-boss directly.** They would need the gp-api database,
  or a new gp-api endpoint and credential per sender.
- **Keep the handlers in the consumer.** No edge tests, no per-type alerts, and
  the consumer keeps its business logic.

## Revisit if

A sender can reach gp-api another way that is as durable as SQS.
