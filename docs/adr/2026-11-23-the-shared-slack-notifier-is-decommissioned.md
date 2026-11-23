---
title: The shared Slack notifier is retired; four gp-ai members stop reporting failures
status: active
decided_by: [swain]
date: 2026-11-23
code: ['#4026']
scope:
  - packages/gp-ai/infrastructure/modules/alert-filter/**
  - packages/gp-ai/infrastructure/modules/autopilot-agent-fargate/**
  - packages/gp-ai/infrastructure/modules/autopilot-bot/**
  - packages/gp-ai/infrastructure/modules/pmf-engine-fargate/**
  - packages/gp-ai/infrastructure/environments/**
  - packages/gp-api/deploy/components/alerts.ts
supersedes: []
superseded_by:
---

# The shared Slack notifier is retired; four gp-ai members stop reporting failures

## Decision

`shared-slack-notifier` is deleted — the Lambda, its Terraform root and its
source. autopilot-bot, case-scout, PMF Engine and autopilot-agent stop
reporting failures entirely. The alert filter keeps running and loses its
notifier subscription; its Grafana-to-Slack path uses a bot token and is
unaffected. The Grafana rule that watched the notifier's own `Errors` metric
goes with it, since there is no longer a Lambda to watch.

The orphaned SNS subscriptions and lambda invoke permissions are dropped from
Terraform state with `removed { lifecycle { destroy = false } }` rather than
destroyed: the release train refuses any plan containing a delete or a replace
(`scripts/ci-apply-root.sh`), so a real delete would block every root that
touches one of these topics until an admin applied by hand. An admin deletes
the Lambda root and unsubscribes the leftovers once.

## Context

The notifier's Slack incoming webhook belonged to a user whose account was
deactivated on 2026-07-31, and every delivery after that failed silently. For
four months no gp-ai failure alarm reached anyone, and the only signal that
anything was wrong was the guard rule watching the Lambda's own errors. The
choice was to replace the credential and keep the notifier, or to stop
reporting through it. The members that used it either have their own alerting
(the alert filter's bot-token path) or fail in ways nobody was acting on.

## Alternatives rejected

- **Rotate the webhook and keep the notifier.** Four months of silence proved
  nobody was reading the channel it fed, so a new credential buys the same
  outcome with a live secret to maintain.
- **Point the notifier at the swarm webhook.** #4022 already did the swarm
  migration for the two pipelines whose failures a swarm can diagnose
  (serve-analyze, DDHQ matcher); the rest do not have a swarm story.
- **Destroy the subscriptions with `removed { destroy = true }`.** The default
  is a real `delete`, which `ci-apply-root.sh` counts and refuses.

## Revisit if

A gp-ai member needs failure alerting again: give that member its own
subscriber (email or the swarm forwarder) rather than reintroducing a shared
notifier Lambda.
