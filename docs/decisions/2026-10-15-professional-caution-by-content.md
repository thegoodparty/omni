---
title: The professional caution triggers on what the answer says, including relayed guidance
status: active
decided_by: [melecia-gp]
date: 2026-10-15
code: ['#2856']
scope:
  - packages/gp-api/src/chats/general/chief-of-staff/services/chiefOfStaffPrompt.ts
  - packages/gp-api/src/chats/briefing-chats/services/systemPromptBuilder.ts
supersedes: []
superseded_by:
---

# The professional caution triggers on what the answer says, including relayed guidance

## Decision

The Chief of Staff and the briefing chat include the professional caution line when the answer says what is safe, risky, or advisable for human health or public health, finances or taxes, or employment. That holds when the answer relays an agency's guidance or drafts what the user should tell residents. The rule describes the answer's content, as the legal bullet beside it does, rather than naming a topic.

## Context

On the merged Chief of Staff build (omni #2809) the bench's boil-water case, which asks what to tell residents about bathing a baby, got the professional line in three of five replies and no caution of any kind in the other two. The rule at the time said "when your answer is medical or public-health, financial or tax, or employment or HR advice". The legal bullet in the same block, which triggers on what the answer says, held in all fifteen legal replies of the same run. The briefing chat's twin block scored nine of ten on its medical case. Until this decision every professional-advice bench case was medical; none covered finance, tax, or employment. A local eval added with the change (six questions, five samples each, the real prompt against the production model service) put the new wording at a full caution line on 24 of 25 answering replies with no false fires on the ten quiet ones; main's wording missed the employment question in every sample.

## Reasoning

The two misses relayed an agency's guidance for the official to pass on to residents, and the model treated that as communications help rather than advice. Naming the decision the model gets wrong (relayed guidance is still advice) fixes it at the point of failure. Describing the trigger by content keeps the professional bullet in the same form as the legal bullet, which works. No code backstop can carry this line, because nothing deterministic marks a public-health, financial, or employment answer.

## Alternatives rejected

- A code backstop on health, finance, or employment words: rejected because a word list would be making a semantic judgment and would miss every topic it does not name.
- Leaving the rule as a topic label and accepting the miss rate: rejected; the case fails the bench's high bar.

## In their words

"we can use (When your answer says what is safe, risky, or advisable for human health or public health, finances or taxes, or employment, include this line once, in these exact words: "${PROFESSIONAL_LINE}". This applies even when you are relaying an agency's guidance or drafting what the user should tell residents.)" Agent session with @melecia-gp, 2026-10-15.

## Revisit if

The post-change bench run shows the professional line on answers about the city's own finances or staffing, where the subject of "finances" and "employment" is the government rather than a person, or the miss rate on the medical case does not move.
