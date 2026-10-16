---
title: Reporting back is exempt from the good read gate, and Get answers can be pressed again
status: active
decided_by: [bryclevgp]
date: 2026-10-15
code: ['#2852']
scope:
  - packages/gp-api/src/chats/general/priority-flow/**
  - packages/gp-api/src/chats/general/chief-of-staff/services/chiefOfStaffPrompt.ts
  - packages/gp-api/src/priorities/util/priorityReadStatus.util.ts
  - packages/gp-webapp/app/dashboard/priorities/**
supersedes: []
superseded_by:
---

# Reporting back is exempt from the good read gate, and Get answers can be pressed again

## Decision

Before a priority has a good read, the assistants hold back its results: no
themes, splits or quotes. Two exceptions stay on purpose:

1. Reporting back to the people a text asked is not sharing a read. When an
   official opens a report back, the assistant still walks through the themes of
   that send.
2. The Get answers button can be pressed more than once. Its hidden chat turn is
   skipped only when it is already in the thread since the official last typed,
   not anywhere in the conversation's history.

## Context

#2852 added the good read gate: results stay hidden until a priority has enough
answers for its district (about 96). The gate covered every way the assistants
talk about results, which would have reached the report back flow too. Code
review asked for Get answers to be blocked once its turn appeared anywhere in the
thread.

## Reasoning

Reporting back closes the loop with the residents who answered. Holding it until
a good read would break that flow and leave residents unheard back. Getting more
answers is something an official may need to do several times before a read is
good, so a button that works once would strand them.

## Alternatives rejected

- **Gate report backs too.** Rejected: it breaks reporting back.
- **Allow Get answers once per conversation.** Rejected: the button would stop
  working after the first press, while more answers are still needed.

## In their words

"Agreed" (agent session with @bryclevgp, 2026-10-15, confirming both exceptions)
