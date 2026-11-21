---
title: The PR guard dispatches judge-eval and stays neutral in shadow
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

# The PR guard dispatches judge-eval and stays neutral in shadow

## Decision

`judge-guard.yml` is back, in the shape the old guard had. It runs on
`pull_request_target`, derives the suites a diff reaches (an exact-path floor
plus a picker that only adds), dispatches `judge-eval.yml` for them over the
REST API, and posts one check, "Universal judge (shadow)". Every swept result is
neutral with the verdict in the title, so the check never goes red, and the
whole workflow sits behind `JUDGE_GUARD_ENABLED`. It holds no AWS credentials
and no id-token, and there is no per-PR spend cap.

The deletion of the sweep, its six workflows, the S3 staging and the AWS role
stands. Only "nothing replaces the PR guard yet" is replaced.

## Context

The previous record dropped the guard because a trigger on `judge-eval.yml`
would have fired paid runs before the suites existed. They exist now: each
`*.eval.ts` file is a suite, so the floor reads the eval files themselves and
needs no hand table. The guard's state (a spend ledger, baselines, S3 handoffs)
existed only to feed and price the old sweep, and none of it comes back.

## Alternatives rejected

- **A `workflow_call` into `judge-eval.yml`.** The guard would then have to hold
  every permission the called job holds. A dispatch keeps the spending run
  separate, started from main.
- **Keep the old spend cap.** Decided against by the owner of the judge; the
  guard does not price runs.

## Revisit if

The check is promoted to required, or a PR's run cost needs a bound again.
