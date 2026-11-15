---
title: A background agent is one long conversation; later decomposition uses subagents, not stages
status: active
decided_by: [swain]
date: 2026-11-14
code: ['#3835']
scope:
  - packages/gp-api/src/agents/**
supersedes: []
superseded_by:
---

# A background agent is one long conversation; later decomposition uses subagents, not stages

## Decision

A background run is one long conversation: one prompt, one model, its tools
and an output schema. No stages, nodes or graphs. No multi-stage work at all
until every background agent has moved into gp-api.

When an agent later needs splitting, it calls another agent as a tool (a
subagent). A subagent's steps go in the same conversation as the run, on
rows tagged with an `agent` column: `main`, or `<name>:<inputHash>` for a
subagent. The tag is for measurement only; resume reads `main` rows. Cost
per subagent is its rows' token counts priced per model, grouped by
`agent`. Grafana spans give the dashboards.

## Context

#3812 split meeting briefings into three stages (find the agenda, read the
packet, write the briefing) with our own runner, routing and a child
conversation per stage. #3828 dropped the stages. On the same office and
meeting it took 8 steps against 18 and under a fifth of the model cost, and
its resume kill test about half: the model read the packet and wrote the
briefing in one context, with nothing restated between stages. One meeting is not a
quality comparison; the universal judge is how to make one.

## Alternatives rejected

- **Stages with our own runner (#3812).** Runner, routing and child
  conversations to maintain, and context restated at every stage.
- **LangGraph graphs.** See
  `2026-11-15-agents-run-on-the-ai-sdk-not-langgraph.md`.
- **Subagents in conversations of their own.** A run's cost and steps would
  be spread over several conversations; one conversation keeps the whole
  run in one place.

## Revisit if

A migrated agent does not fit one context, or the judge shows that
splitting one improves its output.
