---
title: The Universal Judge scores typed-label agents against written expected labels, its one exception to "no gold answers"
status: active
decided_by: [dealvz]
date: 2026-11-18
code: ['#PR_NUMBER']
scope:
  - packages/gp-api/src/chats/evals/judge/labeled/**
  - packages/gp-api/src/chats/evals/judge/cases/reply_intent.json
supersedes: []
superseded_by:
---

# The Universal Judge scores typed-label agents against written expected labels, its one exception to "no gold answers"

## Decision

The judge gains a `labeled` agent shape for features whose output is a
typed label (a boolean, a choice or a score) rather than prose. A labeled
case list carries each input with the labels a person meant by it, and a
sweep scores both arms against the candidate's expected labels with no model
panel: per-case correctness through the existing exact sign test, Brier per
label beside it, and a floor rule that makes the verdict WORSE when the
candidate answers `false` on a floor label the base arm answered `true`.
Chat and background agents stay pairwise with no answer key. The first
labeled agent is `reply_intent`, which reads inbound replies as an opt-out, a
civic panel join or a panel leave.

## Context

The judge was built on "no gold answers" because prose has no answer key and
writing one per agent is what kept eval coverage near zero. Reading a reply
is different: the right answer is one word, a person can write it down, and
the pairwise panel cannot see a change there, since two arms that disagree on
one label in forty replies read as the same prose. We want to measure today's
regex classifier, then the same cases with a decision model classifying them,
inside the pipeline that already sweeps a PR's arms, prices them and reports.

## Alternatives rejected

- **A separate eval outside the judge.** It would need its own arms, plan,
  cost, guard selection and report, all of which the judge already has.
- **Judging the labels pairwise with the panel.** The panel compares prose,
  and a label flip in one case is noise to it, so a compliance regression on
  one opt-out would read SAME.
- **Scoring against the base ref's labels.** The case list is part of the
  branch under review, so the candidate's labels are the ones a reviewer
  reads. The report names every case whose labels the branch added or
  changed instead.

## Revisit if

Owning the answer key costs more than it buys: wrong expected labels keep
scoring correct changes as worse, or a labeled list grows past what a person
can check by hand.
