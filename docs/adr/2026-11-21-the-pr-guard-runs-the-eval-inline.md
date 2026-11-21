---
title: The PR guard runs the eval inline and stays green in shadow
status: active
decided_by: [agent]
date: 2026-11-21
code: ['#3971']
scope:
  - .github/workflows/judge-guard.yml
  - .github/workflows/judge-eval.yml
  - .github/scripts/judge-*.sh
  - packages/judge/src/guard/**
supersedes: ['2026-11-20-the-judge-workflows-are-deleted.md']
superseded_by:
---

# The PR guard runs the eval inline and stays green in shadow

## Decision

`judge-guard.yml` is back, in the shape the old guard had. It runs on
`pull_request`, derives the suites a diff reaches (an exact-path floor plus a
picker that only adds), and runs them inline against dev and the PR's preview.
The job is the check, "Universal judge (shadow)"; the eval step is
`continue-on-error`, so it never goes red, and the verdict goes in the job
summary and an upserted PR comment. The workflow sits behind
`JUDGE_GUARD_ENABLED`. There is no per-PR spend cap.

The deletion of the sweep, its six workflows, the S3 staging and the AWS role
stands. Only "nothing replaces the PR guard yet" is replaced.

## Context

The previous record dropped the guard because a trigger on `judge-eval.yml`
would have fired paid runs before the suites existed. They exist now: each
`*.eval.ts` file is a suite, so the floor reads the eval files themselves and
needs no hand table. The guard's state (a spend ledger, baselines, S3 handoffs)
existed only to feed and price the old sweep, and none of it comes back.

## Alternatives rejected

- **`pull_request_target` plus a dispatch of `judge-eval.yml`.** It kept the
  PR's code out of the guard, but needed a poll, a run lookup and a posted
  check. `judge-eval.yml` already runs PR code with these secrets, so a PR
  changing its own guard adds no exposure.
- **Keep the old spend cap.** Decided against by the owner of the judge.

## Revisit if

The check is promoted to required, or a PR's run cost needs a bound again.
