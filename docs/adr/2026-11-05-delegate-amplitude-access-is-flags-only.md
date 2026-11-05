---
title: Delegate holds only the Amplitude flag key; analytics and taxonomy are developer-run
status: active
decided_by: [swain]
date: 2026-11-05
code: ['#PR']
scope:
  - .claude/skills/amplitude-flag/**
  - .claude/skills/event-metadata/**
  - .claude/skills/query-analytics-data/**
  - packages/gp-ai/autopilot/agent/amplitude_flags.py
  - packages/gp-ai/infrastructure/modules/autopilot-agent-fargate/main.tf
  - docs/mcp.md
supersedes: [2026-11-04-amplitude-access-amp-cli-and-rest-keys.md]
superseded_by:
---

# Delegate holds only the Amplitude flag key; analytics and taxonomy are developer-run

## Decision

Delegate holds only the Experiment Management API key
(`AMPLITUDE_MANAGEMENT_API_KEY`), for flags. Analytics queries and event
taxonomy writes are developer-run through `amp`, with the Amplitude MCP for
tags and display names. An agent without that access says so and asks a
developer to run the skill.

The flag side of the record this replaces stands: developers drive flags with
`amp`, Delegate with the Management API, every new flag is attached to the
gp-api and gp-marketing deployments in both projects, and releases run through
the `amplitude-flag` skill.

## Context

Delegate's analytics keys, an api key and secret key pair per project, exposed
per-user prod data, and Amplitude can't scope them to aggregates or to
read-only. The keys were revoked in Amplitude and removed from Delegate's
config.

## Alternatives rejected

- Keep the project key pairs on Delegate: per-user prod data reachable from a
  shared agent, with no way to scope it down.
- `amp` with a personal access token on Delegate: capped at 30 days.

## Revisit if

Amplitude issues a long-lived key limited to aggregate, read-only queries.
