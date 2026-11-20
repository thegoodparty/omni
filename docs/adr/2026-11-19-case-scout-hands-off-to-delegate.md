---
title: The case scout hands each night's de-identified cases to the Delegate swarm by signed webhook; gp-api never opens a PR
status: active
decided_by: [dealvz]
date: 2026-11-19
code: ['#TODO']
scope:
  - packages/gp-api/src/caseScout/**
  - packages/contracts/src/caseScout/**
  - packages/gp-ai/infrastructure/modules/case-scout/**
supersedes: [2026-11-16-case-scout-reader-in-gp-api.md]
superseded_by:
---

# The case scout hands each night's de-identified cases to the Delegate swarm by signed webhook; gp-api never opens a PR

## Decision

The case scout still reads, scores, drafts and gates in gp-api as pg-boss
jobs. Its last step changes: gp-api sends one batch a night, the gated and
de-identified cases (`CaseScoutHandoffSchema` in `@goodparty_org/contracts`),
to the Delegate swarm's webhook, signed per Standard Webhooks. The swarm,
a coding agent with GitHub access, writes the cases into the code-form chat
suites and opens the PR. gp-api never holds a GitHub key and never opens a
PR, so the scout's rule holds: no process holds both a user's transcript and
a credential that can write to the public omni repo. Only gated strings leave
the prod boundary; nothing in the batch points back at a conversation. A
switch, off by default, holds each night's batch in the scout's bucket instead
of sending it, so a person reads real batches first. The publisher Lambda in
gp-ai is removed.

## Context

The previous record kept a gp-ai Lambda between gp-api and GitHub: it held
the GitHub App key, appended cases to the old JSON case lists, posted the
Slack note, moved the marker and tracked PR outcomes. The chat suites have
since moved to code form (`*.eval.ts`), which a JSON append cannot write well,
and the Delegate swarm already writes code and opens PRs on omni. Swain
proposed handing the scout's output to Delegate, and the 2026-11-19 standup
(Daniel, Swain, Jeff and Tomer) agreed it. The swarm's webhook verifier
accepts Standard Webhooks, which needs only node:crypto on this side.

## Alternatives rejected

- **Keep the publisher Lambda and teach it the code-form suites.** Editing
  TypeScript from a Lambda is what a coding agent is for, and it keeps a
  second service with a GitHub key and its own alarms.
- **Open the PR from gp-api.** gp-api holds every transcript; giving it a
  key that writes to the public repo breaks the rule above.
- **Send each case as it is drafted.** One batch a night is one signed
  delivery to retry and one PR to review, and a night's drafts are checked
  against each other before any leaves.

## Revisit if

The swarm needs anything beyond the gated strings to write a case, or PR
outcomes are needed back in gp-api to move the nightly cap.
