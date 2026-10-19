---
title: Civic panel outreach runs in two rounds set up once, sized for coverage, with replies coded by AI
status: active
decided_by: [samuelgoodparty]
date: 2026-10-19
code: ['#2969']
scope:
  - docs/features/civic-panel-mrp.md
  - packages/gp-api/src/priorities/util/mrp.util.ts
  - packages/gp-api/src/contacts/utils/civicPanelAllocation.util.ts
  - packages/gp-api/src/contacts/utils/civicPanelBuild.util.ts
  - packages/gp-api/src/priorities/util/priorityReadStatus.util.ts
supersedes: []
superseded_by:
---

# Civic panel outreach runs in two rounds set up once, sized for coverage, with replies coded by AI

## Decision

- **Two rounds, set up once.** Round 1 is doors, calls and a text, up
  front. Round 2 is one text the official approves and pays for at setup,
  whose recipients a model of round 1's answers picks on its scheduled date
  (default two weeks after round 1 starts). No round 3.
- **The official always approves round 2's budget.**
- **Round 1 is sized for coverage:** at least three expected answers from
  every group holding 3% or more of the district, replacing `answersNeeded`
  (10 points at 95% confidence) for this flow.
- **Replies stay free text** and an AI classifier codes each one, with staff
  spot checks.
- **No new results UI.** The model feeds the results page's existing
  status, "hear from more" groups and shares.

## Context

`answersNeeded` sizes for a margin of error that only holds for a random
sample, and residents who answer a text from their official chose to.
Bryan set that sizing on 2026-10-15 (`src/contacts/AGENTS.md`, "Sized in
answers"); this record replaces it for the two-round flow.

## Reasoning

Doors and calls up front reach people texts miss and give the model its
check on texters. A second round chosen by the model gets the benefit of
an iterative design without the official having to come back and act
twice. A fixed YES or NO reply would narrow what residents can say.

## Alternatives rejected

- **Several round 2 batches, a day or more apart.** Rejected: two rounds.
- **A structured YES or NO reply instead of AI coding.** Rejected: it
  constrains responses.
- **A new results view with per-group ranges.** Rejected for now: keep to
  the current UI.

## In their words

"Let's just stick at 2 rounds of outreach, and the second one should just be
texts that can be scheduled for later, so that door kocking and phones go up
front (this is how we're getting the power of an iterative design without
actually requiring users to reliably go into the product to do 2 actions)."

"I think it's better for now to do AI classification so that we don't
constrain the set of possible responses too hard. Always asking the user for
budget approval sounds great."

"I like the sizing that you're describing, that sounds fine."

"I don't want to mess with too much UI, so for now maybe let's just make it
as close as possible to whatever a previous artifact or the current UI
shows"

(agent session with @samuelgoodparty, 2026-10-19)

## Revisit if

The round 1 door and text answerers differ within groups enough that the
model cannot be trusted, or officials reliably come back for a second step.
