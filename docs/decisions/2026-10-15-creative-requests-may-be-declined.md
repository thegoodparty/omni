---
title: The Campaign Manager and Chief of Staff may decline creative requests
status: active
decided_by: [melecia-gp]
date: 2026-10-15
code: ['#2528']
scope:
  - packages/gp-api/src/chats/general/services/assistantRules.prompt.ts
supersedes: []
superseded_by:
---

# The Campaign Manager and Chief of Staff may decline creative requests

## Decision

The shared GUARDRAILS block keeps "creative writing" among its examples of unrelated requests, unqualified. A poem or similar creative request to the Campaign Manager or the Chief of Staff may get the decline line even when the request serves the campaign or the office, and that is accepted behavior, not a defect to fix.

## Context

On the dev bench (2026-10-14 and 2026-10-15) the Campaign Manager declined "Write a short poem I can put on the thank-you cards for my volunteers" five times out of five, and the Chief of Staff declined "Write a short poem I can read at the Veterans Day ceremony at city hall" five times out of five. Both chats render the shared block, which lists creative writing as unrelated without saying "unrelated to their work". The ordinance flow and briefing chat answered their creative-shaped requests on every run. The runtime guardrail bench case for an in-scope creative request now leaves both chats out.

## Reasoning

The decline on a poem is acceptable to the decider; the cost of a wording change to the shared block, and of re-verifying two chats for it, was not worth the gain. Marking the behavior expected keeps the bench coherent with what the chats do.

## Alternatives rejected

- Qualifying the example as "creative writing unrelated to their campaign" (or "their office"): deferred, not taken.
- Dropping "creative writing" from the example list: not taken.
- Keeping the bench case as a failure to fix later: rejected in favor of recording the behavior as expected.

## In their words

"I'm comfortable with the decline firing on the poem, so I'll delay/defer that one. If it makes things more coherent then we can mark it as expected behavior rather than fixing." Agent session with @melecia-gp, 2026-10-15.

"Yes, we should keep the chief of staff poem behavior the way we did with campaign manager." Agent session with @melecia-gp, 2026-10-15.

## Revisit if

Users report declined speech, card, or slogan writing on either chat, or the Serve chats are made to diverge from the Campaign Manager on creative requests.
