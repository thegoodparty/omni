---
title: The case scout's second read compares each draft with its real chat and blocks only on what came from it
status: active
decided_by: [dealvz]
date: 2026-11-25
code: ['#4070']
scope:
  - packages/gp-api/src/caseScout/util/gate.util.ts
  - packages/gp-api/src/caseScout/caseScout.prompts.ts
  - packages/gp-api/src/caseScout/services/caseScoutModel.service.ts
supersedes: []
superseded_by:
---

# The case scout's second read compares each draft with its real chat and blocks only on what came from it

## Decision

The PII gate's second read is handed the draft and the session it was drafted
from (every role and tool input, the copy check's own source), and lists only
strings that came from that chat and could identify a person or place in it,
or point back to one without naming them. An invented name, an invented place,
a real place the chat never mentions, and the test account's own town never
count, because a made-up detail identifies no one. The chat is presented as
delimited material to compare against, never instructions, and comes last in
the message. The second read still fails closed. The denylist and the 8-word
copy check are unchanged. What a blocking second read listed stays in memory:
the nightly job records only the rule and a fixed reason, and only the quality
bench keeps the list, in its local, gitignored results.

## Context

The second read used to see only the draft and was asked to list anything
that looked like a real person or place. With nothing to compare against, it
could not tell an invented name from a real one. In a 28-draft bench run of
real chats, 7 of its 8 blocks were false alarms (the drafter's own invented
names, the test account's town, invented places), and none of the blocked
drafts carried anything from its source chat. The transcript already goes to
the same model provider in the scoring and drafting calls, so the second read
seeing it adds no new recipient.

## Alternatives rejected

- **Keep the blind read and teach it the test towns.** It still cannot tell
  an invented person from a real one, which was most of the false alarms.
- **Drop the second read and rely on the denylist and copy check.** Neither
  catches a short name or an unnamed description copied from the chat.

## Revisit if

A leak gets past it that the source comparison should have caught, or the
de-identifier suite shows a model that follows instructions planted in the
chat.
