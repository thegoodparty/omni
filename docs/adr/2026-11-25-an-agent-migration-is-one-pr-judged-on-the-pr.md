---
title: An agent migration is one PR, judged on that PR, and its rollback is its list lines
status: active
decided_by: [swain]
date: 2026-11-25
code: []
scope:
  - packages/gp-api/deploy/agentsOnGpApi.ts
  - docs/cap-consolidation.md
  - docs/agent-evals.md
---

# An agent migration is one PR, judged on that PR, and its rollback is its list lines

## Decision

Moving a background agent from the PMF Engine to gp-api's engine is one PR: the
agent, its readers, its judge suite, and its entry in the preview, dev and prod
lists in `deploy/agentsOnGpApi.ts`. There is no separate later PR to flip a
switch, and no dev-first stage.

The proof is the pairwise judge on that PR. Dev runs `main`'s lists until the PR
merges, so the base arm is the PMF Engine in dev and the candidate arm is the
PR's preview on gp-api's engine. A verdict of BETTER, NO DIFFERENCE FOUND or
CAN'T SAY with `handledWhen` unregressed, plus Delegate's approval, is the
migration passing; promoting the PR is the migration happening.

Rollback is reverting the PR's list lines. That is safe only because a
migrating agent's readers read a run by id from either engine's table: a reader
that picks its table from `runsOnGpApi` strands every run the other engine
wrote, so the readers must be two-way across the flip.

## Context

The rule this replaces put dev first: land the agent with its switch on in dev
only, compare dev's runs against a preview's, and flip prod in a later PR. It
split one change across two PRs and a window in which dev and prod ran different
engines, which is exactly the state the judge's two arms can already produce
without a second merge. Dev and a PR preview are the comparison the judge
performs; a dev-only landing adds nothing to it.

The lists are the source of truth for which engine runs an agent where, and a
judge run in a preview needs the agent in the preview list or both arms run the
PMF Engine and the suite compares it with itself.

## Alternatives rejected

- **Dev first, prod in a later PR.** Two merges and a dev-vs-prod engine
  divergence for a comparison the judge already makes across dev and a preview.
  Its second PR also has no judge of its own, so the prod flip would be
  unproven.
- **Judge after merging.** The proof would arrive after the change is live,
  and a WORSE verdict would leave only a revert.
- **Readers that keep switching tables with `runsOnGpApi`.** Then reverting the
  list lines orphans the runs the other engine stored, so the advertised
  rollback is not one.

## Revisit if

A migrated agent has a side effect that cannot be undone by reverting a deploy,
or an agent has no pairwise suite at all.
