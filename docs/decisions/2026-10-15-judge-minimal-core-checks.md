---
title: The Universal Judge starts with a minimal set of core checks per agent
status: active
decided_by: [jagoda]
date: 2026-10-15
code: ['#2812', '#2823', '#2836']
scope:
  - packages/gp-api/src/chats/evals/judge/cases/**
  - packages/gp-api/src/chats/evals/judge/README.md
supersedes: []
superseded_by:
---

# The Universal Judge starts with a minimal set of core checks per agent

## Decision

Each judged agent starts with a few core checks (its main job, its top
guardrail, its fallback when data is missing), and the set grows when the judge
misses a real regression. The judge is the cheap, general regression check on
every PR. Nuanced quality grading belongs to golden evals.

## Context

Most agents had no checks before this. Tests showed a check catches a
regression when a change makes the agent break the rule it covers, and stays
quiet on unchanged code. A check is only useful while main passes it.

## Reasoning

A minimal set covers every agent now, keeps sweeps cheap, and is easy to
extend: adding a check is two fields in a case file.

## Alternatives rejected

- A full case list per agent up front: slow, costly, and overlaps golden evals.
- Relying on the overall score without checks: it was unreliable for specific
  breaks.

## In their words

> "I think it makes sense for the initial set to be pretty minimal (so long as
> we can easily add and iterate going forward)."

Jeff, Slack, 2026-10-15.
