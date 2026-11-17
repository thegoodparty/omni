---
title: The case scout reader runs as gp-api pg-boss jobs; the publisher stays outside gp-api, so no process holds both a transcript and the GitHub key
status: active
decided_by: [dealvz]
date: 2026-11-16
code: ['#3849']
scope:
  - packages/gp-api/src/caseScout/**
  - packages/gp-ai/case_scout/**
supersedes: []
superseded_by:
---

# The case scout reader runs as gp-api pg-boss jobs; the publisher stays outside gp-api, so no process holds both a transcript and the GitHub key

## Decision

The nightly case scout's reader (read the night's chats, split sessions, score
on Opus, draft fictional cases, run the PII gate) runs in gp-api as a pg-boss
schedule that fans out one job per session and one drafting job per night.
gp-api writes the night's files to the scout's bucket and invokes the existing
publisher Lambda in gp-ai, which holds the GitHub App key and opens the PR.
gp-api never holds that key. The rule this keeps, from the scout's design: no
process holds both a user's transcript and a credential that can push to the
public omni repo, so a model misled by a chat message cannot publish anything.

## Context

The reader was built as a Fargate task reading a Databricks view over live
federation of gp-api's Postgres. That needed a service principal, a warehouse,
grants, four secrets and a breakglass write, none of which had landed. gp-api
already reads these transcripts to serve every chat, already has the Anthropic
provider, S3 and the election database, and pg-boss gives retries, keyed
fan-out, dead letters and alerts. The suggestion came up on the 2026-11-16
team call.

## Alternatives rejected

- **Keep the Fargate reader on Databricks.** It works, but every piece of its
  data path was still unprovisioned, and it carries a second copy of the case
  schema that can drift from `ChatCaseSchema`.
- **Move the publisher into gp-api too.** One process fewer, but gp-api, the
  largest internet-facing service and the holder of every transcript, would
  gain write access to the public repo, which breaks the rule above.

## Revisit if

The publisher needs data only the reader has, or GitHub access can be scoped
so narrowly that holding it beside transcripts no longer matters.
