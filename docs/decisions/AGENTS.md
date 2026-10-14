# Human decisions

One file per decision a person made on purpose: a product rule, an architecture
choice, a process. The point is that someone about to undo it, human or agent,
finds out first. The rules for when to check and when to write one are in the root
`AGENTS.md` ("Human decisions"). This file is the format.

## What earns a record

A deliberate choice someone could reasonably undo without knowing it was
deliberate. Not style, not conventions already written in an `AGENTS.md`, and never
an agent's own implementation choices.

The decision must come from a human. An agent may type the file, but only from
what a human said, and only after the human has seen the draft and said yes.

## File

`docs/decisions/YYYY-MM-DD-short-slug.md`, dated by when the decision was made.

```markdown
---
title: <the decision as a short rule>
status: active # active | superseded
decided_by: [<github-handle>] # the humans who made the call
date: YYYY-MM-DD
code: [<sha>, '#<pr>'] # at least one commit on main or PR number
scope: # paths this decision governs
  - packages/<pkg>/src/<area>/**
supersedes: [] # filenames of records this one replaces
superseded_by: # set when a later record replaces this one
---

# <title>

## Decision

The rule, in one or two sentences.

## Context

What forced the choice. The constraints and facts at the time.

## Reasoning

Why the decider chose this. Their reasoning, in their words where possible.

## Alternatives rejected

Each option that lost, and why.

## In their words

At least one verbatim excerpt from the decider, each with where it was said: a
link to the PR comment, review, Slack message or meeting notes, or
"agent session with @<handle>, YYYY-MM-DD" when said directly to an agent.

## Revisit if

Optional. What the decider said would change their mind.
```

## Rules

- **Supersede, don't edit.** Once merged, only change a record to set `status` and
  `superseded_by`, or to fix a typo or a dead link. A change of mind is a new
  record with `supersedes` pointing at the old one.
- **Code link in the same PR.** If the record ships with the code it governs, add
  the PR number to `code` once the PR is open. Squash merges change commit SHAs, so
  a branch SHA will not survive.
- **Keep it out of the record:** voter or customer records, personnel matters,
  financial figures and secrets. Link to where they live instead.
