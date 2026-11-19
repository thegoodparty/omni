---
title: Background agents return their output through a submitOutput tool
status: active
decided_by: [swain]
date: 2026-11-14
code: ['#3835']
scope:
  - packages/gp-api/src/agents/**
supersedes: []
superseded_by:
---

# Background agents return their output through a submitOutput tool

## Decision

Every background run gets a `submitOutput` tool whose input is
`{ output: <the agent's output schema> }`. The model sees the JSON schema.
Zod checks the call; a miss returns the list of problems (path and message),
never the whole input, and the model submits again. The run ends on the
first accepted call. On resume, an accepted call already in the saved steps
sends the run straight to `onArtifact`.

## Context

A spike tried the AI SDK's own structured output (`Output.object`) with the
meeting briefing schema, against the real API with `claude-sonnet-4-6`, on
AI SDK 6 and 7:

- Strict mode rejects the schema: 58 optional properties against a limit
  of 24, and 48 union properties against 16. Every `.nullable()` counts.
- Non-strict mode needs an object at the root (so a wrapper, as
  `submitOutput` has), allows one tool call per step (research steps stop
  running in parallel), and needs forced tool use, which extended thinking
  and some newer models refuse.
- On a miss neither version retries. They throw an error carrying the whole
  object, about 30k tokens for a briefing, so we would write the same retry
  `submitOutput` already has.

## Alternatives rejected

- **`Output.object` in strict mode.** Cannot take the schema.
- **`Output.object` in non-strict mode.** Slower runs, model limits, and
  our retry anyway.
- **Free text parsed after the loop.** No way to tell the model what was
  wrong while it still has the context.

## Revisit if

Provider limits grow to fit our output schemas and the SDK retries with
short errors. `Output.object` already works for small schemas (at most 24
optional and 16 union properties, an object at the root).
