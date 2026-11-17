---
title: An agent run's spend is its stored tokens, priced where it is read
status: active
decided_by: [swain]
date: 2026-11-17
code: ['#3835']
scope:
  - packages/gp-api/src/agents/**
  - packages/gp-api/prisma/schema/agentMessage.prisma
supersedes: []
superseded_by:
---

# An agent run's spend is its stored tokens, priced where it is read

## Decision

No cost is stored anywhere in the agents code. An `AgentMessage` row that is
an assistant turn records `model`, `inputTokens`, `outputTokens`,
`cacheReadTokens` and `cacheWriteTokens`, and that is all. There is no
`costUsd` column, no `agent_run.cost_usd`, and no price table in
`src/agents`.

Grafana Agent Observability prices the calls for dashboards. Any later
analysis prices the stored tokens.

## Context

The first build copied the judge's price table into `src/agents/modelPricing.ts`
so a run could record `costUsd`, with a test keeping the copy equal to the
original (`src/chats/evals` is out of the production build, so it cannot be
imported). A stored price is wrong the moment a provider changes one, and it
is wrong silently: nobody re-derives a column that is already filled in. The
copy also had to be kept equal to a second one by hand, and there were already
two copies of that table in the repo.

Tokens are the fact the provider reports. A price is an interpretation of it,
and it belongs where it is read.

## Alternatives rejected

- **A `costUsd` on the run, priced at write time** (the reference build): the
  number freezes a price that will change, and the recording code carries a
  price table it has no other use for.
- **Pricing every step and summing** (also the reference build): same stale
  number, and one unpriceable model makes the whole total null.
- **A `model_price` table in the database**: a migration and a second source
  of truth for something Grafana already prices.

## Revisit if

Someone needs spend without Grafana, e.g. a customer-facing usage report. Then
a price table arrives as its own change, and the stored tokens are what it
reads.
