---
title: A ready civic panel is a priority check's default first round
status: active
decided_by: [bryclevgp]
date: 2026-10-29
code: ['#3380']
scope:
  - packages/gp-api/src/chats/general/priority-flow/priorityFlow.prompt.ts
  - packages/gp-api/src/chats/general/priority-flow/priorityFlow.handler.ts
  - packages/gp-api/src/chats/general/chat-tools/sizeRoundOne.tool.ts
  - packages/gp-api/src/contacts/utils/civicPanelAllocation.util.ts
supersedes:
  - 2026-10-23-priority-round-one-is-a-text.md
superseded_by:
---

# A ready civic panel is a priority check's default first round

## Decision

Behind `serve-citizen-panels`, when the office's managed civic panel is
ready and a check is warranted, the priority chat leads with asking the
civic panel and lets the official choose. It asks once, with three options
in order: ask your civic panel (one text to its members), a text to
residents across the district, or another kind of outreach. With any other
managed status, or none, the first round is one text to residents across
the district, as before: `size_round_one` sizes it so every major group is
expected to bring `MIN_VOICES_PER_GROUP` answers at the text reply rate,
and it returns one card. That text always carries the JOIN ask, because
replying JOIN is the only way anyone joins a civic panel.

The handler reads the managed civic panel once per conversation open and
reuses it for later turns, held in memory on the handler, because its
status changes at most daily.

## Context

The round one text was the only first round, and a ready civic panel was
asked only when the official thought to ask for it. Its members signed up
to answer questions like a priority's. Door knocking and phone banking stay
out of round one's sizing; they are reachable as the third option.

## Alternatives rejected

- Ask the civic panel without asking the official. It takes the
  district-wide text away from an official who wants a wider read.
- Keep the text first and ask the civic panel only on request. It leaves
  the civic panel GoodParty built for the office to the official to
  remember.
- Store the civic panel status on the conversation row. It needs a
  migration for a value that changes at most daily.

## Revisit if

Officials mostly pick the text over a ready civic panel, or a civic panel's
answers read as too narrow to stand for the district.
