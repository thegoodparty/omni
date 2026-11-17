---
title: An agent's web search is Brave, as a TypeScript tool
status: active
decided_by: [swain]
date: 2026-11-17
code: ['#3835']
scope:
  - packages/gp-api/src/agents/**
supersedes: []
superseded_by:
---

# An agent's web search is Brave, as a TypeScript tool

## Decision

An agent searches the web through one tool, `webSearch` in
`src/agents/tools/webSearch.ts`, which calls Brave's Web Search API with
`BRAVE_API_KEY` and returns the ranked result URLs with titles and snippets.

No provider-native web search (Anthropic's `webSearch_20250305`), and no
per-agent `maxUses` cap. The run's step budget bounds how many searches a run
can make.

## Context

The two kinds of search differ in what the model gets back. Brave returns the
URLs, so the model can hand one to `fetchPage` and read the page; Anthropic's
native search answers inside the provider and hides the URLs, which is why the
ordinance flow already chose Brave and gates it on the key. An agent that can
only see an answer it cannot re-read or cite from is worse at grounding, which
is the axis the migration is judged on.

`maxUses` is a per-call knob on a provider feature we are not using, and it
duplicates the budget: a step is a model call, and the budget already caps
those.

## Alternatives rejected

- **Anthropic's native web search**: hides the result URLs, Anthropic-only,
  and its `maxUses` is a second cap next to the step budget.
- **Both, per agent**: two search behaviours to judge and two to maintain,
  for no case the migration has.
- **The ordinance flow's `OrdinanceFlowSearchService`**: that one carries
  ordinance-shaped deps and a Nest injection seam; an agent tool is a plain
  function.

## Revisit if

A provider offers search that returns the URLs, or an agent needs a search
feature Brave does not have.
