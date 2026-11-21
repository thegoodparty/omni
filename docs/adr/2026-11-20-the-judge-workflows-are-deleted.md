---
title: The judge sweep's six workflows are deleted; nothing replaces the PR guard yet
status: superseded
decided_by: [agent]
date: 2026-11-20
code: []
scope:
  - .github/workflows/judge*.yml
  - .github/scripts/judge-*.sh
  - packages/gp-api/src/chats/evals/judge/**
supersedes: ['2026-11-12-ci-jobs-running-pr-code-assume-pull-request-role.md']
superseded_by: 2026-11-21-the-pr-guard-dispatches-judge-eval.md
---

# The judge sweep's six workflows are deleted; nothing replaces the PR guard yet

## Decision

`judge.yml` and its four satellites (`judge-request`, `judge-comment`,
`judge-guard`, `judge-schema-check`) are gone, with the sweep they ran, the
`judge-*` shell scripts they called, and the `github-actions-judge-sweep` role
target. Chat and background agents are judged by `/judge-eval <suite>` in
`judge-eval.yml`, which holds a base URL and two deploy origins: it needs no
AWS credentials, no arm worktrees and no S3 staging.

The old guard ran the judge on a PR's chat changes automatically. Nothing
replaces it. A PR that changes a chat agent's prompt or tools is judged only
when a person comments `/judge-eval`, until the chat suites cover it.

## Context

The sweep's 24,000 lines existed to run agents: two checkouts at two commits,
S3 staging, SQS dispatch, page replay, arm budgeting, one worktree and one
process per arm. The base-URL framework runs one process holding two URLs and
does not need any of it, so keeping the sweep for the five chat case lists was
paying that whole cost for a comparison the framework now makes itself.

`supersedes` names the record that pinned the pull-request role to `judge.yml`.
The two-role rule itself stands, and the job that runs pull request code still
takes the pull-request role whatever ref starts it; there is no longer such a
job among these workflows.

## Alternatives rejected

- **Keep the guard and point it at `/judge-eval`.** It would fire a paid
  pairwise run on every PR touching a chat file, on suites that are still being
  filled in, before anyone has decided which suite a chat change should
  trigger. The suites and their triggers come first.
- **Keep `judge.yml` for the five chat lists.** It is the sweep's cost for a
  comparison the framework already makes, and the lists are the case scout's
  inbox now, not a judge's input.

## Revisit if

A chat change needs automatic judging on PRs. The trigger belongs on
`judge-eval.yml`, which already has the arms.
