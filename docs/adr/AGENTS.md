# Architecture decision records

One file per technical architecture decision, so the next person or agent does
not quietly undo it. When to check and when to write one is in the root
`AGENTS.md` ("Architecture decisions"). This file is the format.

## What earns a record

A choice about how the system is built that crosses a module or service
boundary, or is costly to undo: data model, service boundaries, auth, queues,
infra, vendors, wire and file formats. Only when a real alternative was on the
table.

Not product behavior, copy, agent prompts or style. Not a convention an
`AGENTS.md` already states.

## File

`docs/adr/YYYY-MM-DD-short-slug.md`, dated by when the decision was made. Keep
the body under about 60 lines.

```markdown
---
title: <the decision as a short rule>
status: active # active | superseded
decided_by: [<github-handle>] # humans who decided, or [agent]
date: YYYY-MM-DD
code: ['#<pr>'] # at least one PR or commit on main
scope: # paths this decision governs
  - packages/<pkg>/src/<area>/**
supersedes: [] # filenames of records this one replaces
superseded_by: # set when a later record replaces this one
---

# <title>

## Decision

The rule and why, in a short paragraph.

## Context

What forced the choice. The constraints and facts at the time.

## Alternatives rejected

Each option that lost, and why.

## Revisit if

Optional. What would change the answer.
```

## Rules

- **Name who decided.** `decided_by` is the GitHub handles of the humans who
  made the call, or `[agent]` when an agent chose and no human weighed in. Never
  put a human's handle on a choice they did not make.
- **Supersede, don't edit.** Once merged, only change a record to set `status`
  and `superseded_by`, or to fix a typo or a dead link. A change of mind is a new
  record with `supersedes` pointing at the old one.
- **Ship it with the code.** Add the record in the PR that implements the
  decision, and put that PR number in `code`. Squash merges change commit SHAs,
  so a branch SHA will not survive.
- **Keep it out of the record:** voter or customer records, personnel matters,
  financial figures and secrets. Link to where they live instead.
