---
title: Agent traces and cost go to Grafana Agent Observability, with no prompt text
status: active
decided_by: [swain]
date: 2026-11-13
code: ['#3835']
scope:
  - packages/gp-api/src/agents/**
  - packages/gp-api/src/llm/**
  - packages/gp-api/src/otel.ts
supersedes: []
superseded_by:
---

# Agent traces and cost go to Grafana Agent Observability, with no prompt text

## Decision

Every agent run, model call and tool call is an OpenTelemetry span from
gp-api to Grafana Cloud, read in Grafana Agent Observability (enabled for
our stack). Spans carry token counts, never prompt or reply text, the same
default chat has today (`recordInputs: false`, `recordOutputs: false` in
`llm.service.ts`), because prompts carry voter data. We build no counters
or panels of our own for agents. Braintrust tracing goes away with the
broker.

## Context

We already run Grafana Cloud for logs, metrics and traces
(`docs/observability.md`), and chat already sends AI SDK spans to Tempo.
Background runs send one span through the broker to Braintrust, which
nobody reads. Agent Observability is built on OpenTelemetry, reads AI SDK
spans, and shows model calls, tool calls, tokens and cost per conversation.

## Alternatives rejected

- **Braintrust.** A second vendor whose traces nobody reads today.
- **Our own counters and dashboards.** Code and panels to maintain for what
  the app already shows.
- **Sending redacted prompt text.** A separate, later decision.

## Revisit if

Its pricing at our volume is too high, or debugging needs prompt text and
redaction is decided.
