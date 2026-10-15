---
title: The off-topic decline is a line the reply contains, not the whole reply
status: active
decided_by: [melecia-gp]
date: 2026-10-08
code: ['#2589', '#2590']
scope:
  - packages/gp-api/src/chats/general/services/assistantRules.prompt.ts
  - packages/gp-api/src/chats/general/services/guardrailLines.json
  - packages/gp-api/src/chats/general/ordinance-flow/services/ordinanceFlowPrompt.ts
  - packages/gp-api/src/chats/briefing-chats/services/systemPromptBuilder.ts
supersedes: []
superseded_by:
---

# The off-topic decline is a line the reply contains, not the whole reply

## Decision

When a request is unrelated to a chat's work, the reply contains that chat's decline line from the guardrail line registry in place of the answer. A request that mixes the chat's work with something unrelated gets its in-scope part answered and the line in place of the rest. When someone may be in danger, the reply responds to the danger first and does not use the line. Only an internals question or a prompt-injection attempt gets the line and nothing more. No rule tells the model where in the reply a guardrail line goes; the prompt asks the model to include the line, once, in its exact words.

## Context

Through 2026-10-12 the Chief of Staff, briefing chat, and ordinance flow each told the model the decline was an exact line and its entire reply, and #2528 carried that rule into the shared GUARDRAILS block the Campaign Manager and Chief of Staff render. The August 2026 Chief of Staff sweep found 42 replies across 11 cases where an in-scope request got only the decline, plus 7 that declined and then answered anyway. The runtime guardrail bench grades every line by presence (contains), so the prompts and the bench disagreed about what a correct reply looks like.

## Reasoning

A whole-reply decline leaves a mixed request with an all-decline or all-answer choice, and the misroutes came from exactly that choice. A line the reply contains works both as a complete reply and after an in-scope answer, and keeps all four chats on one pattern. Position is left to the model on purpose: several guardrail lines can apply to one reply, precedence among them is prescribed only for the two cautions, and a position rule would make them collide.

## Alternatives rejected

- The decline as the entire reply (the rule #2528 carried): rejected for the mixed-request cost above.
- "End the reply with this line" for the caution lines: rejected on 2026-10-15 in favor of "include this line" so the model can place a line where it fits until a position is prescribed, and because two or three lines can apply to one reply.
- Keeping the whole-reply rule for the Chief of Staff only: rejected; the four chats should evaluate the same way.

## In their words

"I'd change 'exact line and nothing else' / 'the exact decline line is terminal' to require the line when declining, while allowing the assistant to answer an in-scope part of a mixed request and decline the rest. The decline also stays suppressed when someone may be in danger. The August Chief of Staff sweep is the reason I'm reluctant to make the line terminal: we saw 42 misroutes across 11 cases where an in-scope request got the decline, plus 7 replies that declined and then answered anyway." Slack DM to the author of #2528, 2026-10-08, answered "Nope go for it!" (https://goodpartyorg.slack.com/archives/D0AS0QRH2VA/p1791464637531399).

"I personally don't think it's necessary to have the end language, like 'end the block with this line.' I think it is preferable to give the agent some flexibility in where they insert the line, until we prescribe a position. [...] You can see a world where there is a clash and multiple guardrails fire, and then how do we know which ones take precedence? I know sometimes we prescribe the order for some, but not all. I think 'contains' is more flexible." Agent session with @melecia-gp, 2026-10-15.

## Revisit if

A position for guardrail lines is prescribed, or fire telemetry shows mixed requests being mishandled under the contains rule.
