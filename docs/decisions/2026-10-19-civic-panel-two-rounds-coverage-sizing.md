---
title: Civic panel outreach runs in two rounds set up once, sized for coverage, with replies coded by AI
status: active
decided_by: [samuelgoodparty]
date: 2026-10-19
code: ['#2969', '#2985']
scope:
  - docs/features/civic-panel-mrp.md
  - packages/gp-api/src/priorities/util/mrp.util.ts
  - packages/gp-api/src/contacts/utils/civicPanelAllocation.util.ts
  - packages/gp-api/src/contacts/utils/civicPanelBuild.util.ts
  - packages/gp-api/src/priorities/util/priorityReadStatus.util.ts
  - packages/contracts/src/outreach/ServeSms.schema.ts
  - packages/gp-api/src/outreach/services/outreachServeSmsCreate.service.ts
supersedes: []
superseded_by:
---

# Civic panel outreach runs in two rounds set up once, sized for coverage, with replies coded by AI

## Decision

- **Two rounds, set up once.** Round 1 is doors, calls and a text, up
  front. Round 2 is one text the official approves and pays for at setup,
  whose recipients a model of round 1's answers picks on its scheduled date
  (default two weeks after round 1 starts). No round 3.
- **Round 2 is the held half of one text purchase** (2026-10-20). The
  official buys one text of N: half go out at random on the chosen date,
  and the rest are held and sent two weeks later to the groups heard from
  least. The split is a starting point to tune once answer rates are
  measured.
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

"The procedure should be: (1) the user buys a text to a certain number of
constituents, (2) some proportion of those (we could crudely say half,
whatever you think based on our MRP work and best practices) are
immediately randomly sampled and contacted, and then (3) the remainder R is
held out until some time has passed for responses to come in, and then R
people are drawn for a second automatic text round from the groups that
didn't respond much."

(agent session with @samuelgoodparty, 2026-10-20)

## Revisit if

The round 1 door and text answerers differ within groups enough that the
model cannot be trusted, or officials reliably come back for a second step.
