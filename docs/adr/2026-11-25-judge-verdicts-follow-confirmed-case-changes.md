---
title: Universal Judge verdicts follow confirmed changes on individual cases
status: active
decided_by: [swain]
date: 2026-11-25
code: ['#4075']
scope:
  - packages/judge/src/grade.ts
  - packages/judge/src/stats.ts
  - packages/judge/src/reporter.ts
supersedes: []
superseded_by:
---

# Universal Judge verdicts follow confirmed changes on individual cases

## Decision

A confirmed, material regression on any case makes the candidate **Worse**.
If nothing regresses and at least one case improves, it is **Better**. If
neither is confirmed, it is **No difference found**. Improvements elsewhere
do not cancel a regression. Neither the verdict nor its report uses p-values.

The implementation grades blinded outputs in both orders. Both orders must
identify a material change on the same criterion in the same direction, and
that result must recur in at least two attempts on one case. The report names
the case and shows the evidence. A grading disagreement is not a tie, and
insufficient run coverage is an execution status, not a quality verdict.

The automatic PR guard remains advisory. Making it a required check is a
separate decision.

## Context

The previous judge pooled preferences across cases. During the opponent
summary migration, the candidate repeated sourcing errors, but the pooled
result still read **No difference found** ([eval run](https://github.com/thegoodparty/omni/actions/runs/45639919676)).
For a rollout, we need to know whether the candidate broke behavior that
worked before, not just whether its outputs were worse on average.

## Alternatives rejected

- **Keep the pooled significance test, with or without a visible p-value.**
  Hiding the number would still let unchanged or improved cases mask a
  regression elsewhere.
- **Fail on any single base preference.** An isolated preference or an
  order-dependent judgment is not enough evidence that a behavior regressed.

## Revisit if

Before making the guard required, check whether confirmed regressions on
real comparisons are specific enough to fix and stable enough to block PRs.
