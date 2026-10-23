---
title: A priority's first round is one text, sized by size_round_one
status: active
decided_by: [bryclevgp]
date: 2026-10-23
code: ['#3175']
scope:
  - packages/gp-api/src/chats/general/chat-tools/sizeRoundOne.tool.ts
  - packages/gp-api/src/contacts/utils/civicPanelAllocation.util.ts
  - packages/gp-api/src/chats/general/priority-flow/priorityFlow.prompt.ts
supersedes: []
superseded_by:
---

# A priority's first round is one text, sized by size_round_one

## Decision

Behind `serve-citizen-panels`, a priority check's first round is one text
to residents across the district. `size_round_one` counts who a text can
reach by group and sizes it so every major group is expected to bring
`MIN_VOICES_PER_GROUP` answers at the text reply rate, capped by the cell
phones it can reach and the sampler ceiling. It returns one card. Door
knocking and phone banking are not part of round one, there is no weekly
time question, and gp-api picks no walkable area for a priority.

## Context

Round one used to be doors in one walkable area, calls and a text, with the
doors and calls sized from the official's weekly hours through the civic
panel build plan's hours-to-channel math. The managed civic panel deleted
the build plan, and with it the only stored answer to the weekly time
question. Bryan decided on 2026-10-23 to take door knocking and phone
banking out of round one for now. Standalone door knocking and phone
banking, and later rounds the read asks for, are unchanged.

## Alternatives rejected

- Keep the hours math for round one alone, asking the weekly time in the
  priority chat every time. It keeps a sizing model and a question whose
  only other user was deleted, for channels Bryan chose to set aside.

## Revisit if

Offices' own calls and doors measure answer rates good enough to size them,
or officials ask to put doors and calls back in a check's first round.
