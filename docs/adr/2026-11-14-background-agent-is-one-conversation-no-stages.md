---
title: A background agent is one long conversation
status: active
decided_by: [swain]
date: 2026-11-14
code: ['#3835']
scope:
  - packages/gp-api/src/agents/**
supersedes: []
superseded_by:
---

# A background agent is one long conversation

## Decision

A background run is one long conversation: one prompt, one model, its tools
and an output schema, in one context. No stages, nodes or graphs, and no
multi-stage work at all until every background agent has moved into gp-api.

Nothing here forecloses decomposing an agent later. A run's messages are a
flat, ordered list (`AgentMessage`), so whatever comes next — subagents, or
genuine decomposition with its own runner — is free to grow on top of it.

## Context

#3812 split meeting briefings into three stages (find the agenda, read the
packet, write the briefing) with our own runner, routing and a child
conversation per stage. #3828 dropped the stages. On the same office and
meeting it took 8 steps against 18 and under a fifth of the model cost, and
its resume kill test about half: the model read the packet and wrote the
briefing in one context, with nothing restated between stages. One meeting is
not a quality comparison; the universal judge is how to make one.

## Alternatives rejected

- **Stages with our own runner (#3812).** Runner, routing and child
  conversations to maintain, and context restated at every stage.
- **LangGraph graphs.** See
  `2026-11-15-agents-run-on-the-ai-sdk-not-langgraph.md`.

## Revisit if

A migrated agent does not fit one context, or the judge shows that
splitting one improves its output.
