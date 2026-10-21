---
title: Early-vote recommended lists target likely early voters, and the global cards follow the campaign's early-voting window
status: active
decided_by: [nigel-gp]
date: 2026-10-16
code: ['#2943']
scope:
  - packages/gp-api/src/recommendedLists/**
  - docs/features/recommended-lists.md
supersedes: []
superseded_by:
---

# Early-vote recommended lists target likely early voters, and the global cards follow the campaign's early-voting window

## Decision

The independent-leaning and ideology early-vote lists screen on early-vote likelihood (`Early_Vote_Status` Very likely or Likely) instead of the turnout band, not on top of it. The supporter early-vote list is every supporter, unscreened. On the voter data page's recommended-for-you cards, early-vote lists show only from the campaign's early-voting start (BallotReady, else Election Day minus 14) until two days before Election Day, ranked below the intro and support-ID list and above persuade. A flow whose purpose is early voting always gets the lists. Start outreach on the early-vote task opens the purpose step like every other task.

## Context

The early-vote lists were exact copies of the persuade and event lists, a documented v1 choice made because the mart had no early-vote score. gp-data-platform #1215 added `Early_Vote_Status`, the higher of Haystaq's early-in-person and vote-by-mail scores, so the lists can now be a different audience. Recommended lists had no notion of date.

## Reasoning

A voter who tends to vote early is the person to ask to vote early, whether or not they vote reliably, so early-vote likelihood replaces the turnout screen. Every supporter is worth asking, including those for whom early voting would be new. Early-vote lists only make sense while early voting is open, and in that window they matter more than persuasion but less than meeting voters and identifying support.

## Alternatives rejected

- Keep the lists as copies of persuade and event: no early-vote audience, and the dedupe hid them from the recommended-for-you cards.
- Add early-vote likelihood on top of the turnout band: a smaller list that misses less reliable voters who do vote early.
- Screen the supporter list on early-vote likelihood: leaves out supporters who could be encouraged to vote early for the first time.
- Mirror the election-day (GOTV) universes instead of narrowing the existing early-vote ones.
- Gate the lists everywhere by date: a candidate who chooses the early-voting purpose should get them whenever they ask.
- Have Start outreach on the early-vote task preselect an early-vote list: every other task opens the purpose step, and that step already leads to the early-vote lists.
