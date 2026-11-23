---
title: Prod serve-analyze and ddhq-matcher failures go to the swarm webhook, not Slack
status: active
decided_by: [swain]
date: 2026-11-23
code: ['#4022']
scope:
  - packages/gp-ai/infrastructure/modules/swarm-alert-forwarder/**
  - packages/gp-ai/infrastructure/modules/serve-analyze-fargate/**
  - packages/gp-ai/infrastructure/modules/ddhq-matcher-fargate/**
  - packages/gp-ai/infrastructure/environments/*/serve-analyze-fargate/**
  - packages/gp-ai/infrastructure/environments/*/ddhq-matcher-fargate/**
supersedes: []
superseded_by:
---

# Prod serve-analyze and ddhq-matcher failures go to the swarm webhook, not Slack

## Decision

Serve-analyze's `pipeline_failures` and ddhq-matcher's `matcher_failures` SNS
topics deliver, in prod, to a Lambda that POSTs each notification to a Delegate
swarm workflow webhook, so the swarm triages these failures as bugs instead of a
human watching `#ai-service-failures`. The delivery is signed per
[Standard Webhooks](https://www.standardwebhooks.com/), matching the swarm
workflow trigger's `verification: { format: 'standard-webhooks' }`: `webhook-id`,
`webhook-timestamp`, and `webhook-signature: v1,<base64 HMAC-SHA256>` over
`${id}.${timestamp}.${body}`, keyed with the base64-decoded signing secret.

Only prod. `SWARM_ALERT_WEBHOOK_URL` and `SWARM_ALERT_WEBHOOK_SECRET` live in
`AI_SECRETS_PROD`; dev has neither and is not meant to report to the swarm, so
the dev roots subscribe nothing and keep email alone. Every other gp-ai
member's failure topic still goes to `shared-slack-notifier`, unchanged.

## Context

These two pipelines fail in ways a human has to read code to diagnose (a bad
input CSV, a matcher regression), which is the swarm's job. Slack gave the
failure a channel nobody owned. Each environment root instantiates the
forwarder itself and passes the ARN into its own service module, so no root
reads another root's state to find the function it subscribes — the pattern
`prod/shared-infra` reads four roots' state to do that, and an absent key there
is a hard plan failure, not an empty result.

The old subscription is dropped with a `removed { lifecycle { destroy = false } }`
block rather than unsubscribed, because the release train refuses any plan with a
delete (`scripts/ci-apply-root.sh`). It stays in AWS, still delivering to
`shared-slack-notifier`, until an operator removes it by hand.

## Alternatives rejected

- **A single shared forwarder root, read via `terraform_remote_state`.** One more
  root to apply, and it couples two roots to a state file whose absence fails
  their plan, which is the ordering problem `prod/shared-infra` already has.
- **The Stripe-style `t=<ts>,v1=<hex>` header.** The swarm supports it
  (`timestamped-hmac-sha256`), but Standard Webhooks is the spec its
  `standard-webhooks` mode verifies against, and a spec-compliant sender works
  with any other receiver that speaks it.
- **Point the shared Slack notifier at the swarm.** It serves five other members,
  and its webhook key is a Slack credential.

## Revisit if

The swarm stops accepting Standard Webhooks, or dev gains the secrets and should
report too.
