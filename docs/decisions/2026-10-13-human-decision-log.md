---
title: Keep an in-repo log of human decisions, and only humans decide
status: active
decided_by: [swain]
date: 2026-10-13
code: ['#2729']
scope:
  - docs/decisions/**
  - AGENTS.md
  - .claude/skills/ship-pr/SKILL.md
supersedes: []
superseded_by:
---

# Keep an in-repo log of human decisions, and only humans decide

## Decision

Omni keeps a log of decisions people made on purpose in `docs/decisions/`, one
file per decision. Every record comes from a human, carries the decider's
reasoning in detail, and links to at least one code commit or PR. Agents check
the log before changing code it covers, and must tell the human they are working
with before reversing a recorded decision. The guidance lives in the root
`AGENTS.md`. There is no automated enforcement yet.

## Context

A person's work in omni has, more than once, been reverted by someone else who did
not know it was deliberate. Most changes here are made by agents, which start each
session with no memory of why the code is the way it is. The reasoning usually
exists, in PR bodies, revert messages, Slack and meetings, but it is not in front of
whoever is about to undo it.

Dev leadership has also been discussing a wider shared knowledge base for humans
and agents: a central index of code, conversations and documents. This log was
chosen as the first, smaller experiment.

## Reasoning

The aim is that prior decisions are only reversed knowingly, ideally with the
decider's consent, and at minimum with the person reversing it aware that they are
doing so.

Only humans decide. A record an agent wrote from its own judgment would carry the
authority of a decision without anyone having made one.

A one-line quote is not enough detail to judge whether a decision still applies, so
records carry context, reasoning and rejected alternatives. Tying each record to
code keeps it anchored to what it governs.

The guidance belongs in the root `AGENTS.md`, where every agent working in omni
reads it, not only in the `ship-pr` skill.

Enforcement waits: first add the concept and see what people record.

## Alternatives rejected

- **A central context store or index first** (a Pensieve-style index, Unblocked,
  Onyx, or a home-rolled vector index in S3). Not rejected outright, but not first.
- **Agents recording decisions they made themselves.** Rejected: every record must
  come from a human.
- **A one-line quote as the whole record.** Rejected as too thin.
- **Guidance only in the `ship-pr` skill.** Rejected: it belongs in the root
  `AGENTS.md`.
- **Delegate reviewer enforcement in v1.** Deferred until there is something to
  observe.

## In their words

Agent session with @swain, 2026-10-13:

> i've found a few times in omni that one person's contributions will end up being
> reverted by another. I wonder if some kind of "human decision loog" kept in-repo
> would be valuable, plus maybe some kind of very-light automation or agent
> guidance that ensures prior decisions are only ever reversed with consent or
> something. Or at least ensures that the human reverting the decision knows that
> they're doing that.

> My thought is to only encode _human_ decisions for now. i.e. an agent should
> never "decide something" on its own and encode that -- every logged decision
> should be something that came from a human.

> Yeah, it should also encode more detail. the oneline quote is not enough. but, it
> should always be associated with at least one code commit, yeah.

> This guidance should be in the root claude.md in omni -- not just in ship-pr.

> For now, let's not integrate it with delegate reviewer. I just want to add the
> concept, and observe what comes in.

> And, seed one: this decision! The one from me to keep this decision log, and my
> intention for what it hopefully prevents.

## Revisit if

What comes in shows that guidance alone is not enough, for example decisions
reversed without anyone being told. That is the point to consider delegate
reviewer enforcement.
