---
title: The case scout sends each night's batch to Delegate in dev and prod; previews never hold the webhook keys
status: active
decided_by: [dealvz]
date: 2026-11-25
code: ['#4085']
scope:
  - packages/gp-api/src/caseScout/**
  - packages/gp-api/deploy/index.ts
  - packages/gp-api/deploy/gp-api-secret-keys.ts
supersedes: []
superseded_by:
---

# The case scout sends each night's batch to Delegate in dev and prod; previews never hold the webhook keys

## Decision

`CASE_SCOUT_SEND_TO_DELEGATE` is on in dev and prod, so each night's gated,
de-identified batch is POSTed to the Delegate webhook instead of only being
held in the scout's bucket. The webhook URL and signing secret
(`CASE_SCOUT_DELEGATE_WEBHOOK_URL`, `CASE_SCOUT_DELEGATE_WEBHOOK_SECRET`) are
declared for `GP_API_DEV` and `GP_API_PROD` only. Previews keep the switch off
and are given neither key: a preview runs any open pull request's code and
never sends, so it must not hold the key that signs a handoff.

## Context

The handoff record (`2026-11-19-case-scout-hands-off-to-delegate.md`) shipped
with sending off, so a person could read real batches first. By 2026-11-25
every condition for turning it on was met: the de-identifier suite showed
zero leaks, raw and released, on three consecutive full runs; the gate suite
was fully green; the quality bench's released-case count was no lower than
its last run; and Daniel read the first 20 prod cases held in
`case-scout-prod`. What leaves gp-api is still only gated strings with nothing
that points back at a conversation, and every PR the Delegate swarm opens from
a batch is reviewed and merged by a person, so no case reaches a judged suite
unread. Previews share `GP_API_DEV`, so keeping the keys off them means
leaving them out of the preview key list, the same way previews already leave
out the Grafana Cloud token.

## Alternatives rejected

- **Keep holding every night's batch for a person to forward.** The bar for
  sending was met, and a held batch reaches the suites only when someone
  remembers to move it, while the Delegate PR is already a human review.
- **Give previews the full dev key list.** Nothing on a preview sends, and
  the keys would sit in a task running unmerged code.

## Revisit if

A change to the drafter, the gate or the de-identifier fails any of the three
suite results above, or Delegate starts merging scout PRs without a person.
