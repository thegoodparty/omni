---
title: A card's headline is the value, its body is why, and mechanics stay off the card
status: active
decided_by: [bryclevgp]
date: 2026-10-14
code: ['#2762']
scope:
  - docs/product-copy.md
  - packages/gp-api/src/dashboardCards/**
  - packages/gp-webapp/app/dashboard/chief-of-staff/components/**
supersedes: []
superseded_by:
---

# A card's headline is the value, its body is why, and mechanics stay off the card

## Decision

Every card we write leads with what the user gets. The headline names the value
the card brings, and the one-sentence body says why it matters. Cost, counts,
channels and how it works belong in the flow the card opens, never on the card.
Cards that show an item (a meeting briefing, an agenda item, a community issue, a
priority's next step) keep the item as the headline.

## Context

The Chief of Staff's "Build your civic panel" card read "A paid text to up to
3,334 residents, about $117, so you hear from more than the loudest voices." It
led with the price and the send size, so the reason to build a panel came last.
The onboarding cards read as feature descriptions in the same way.

## Reasoning

A card is the first thing an official sees and has to make them want to start.
The value and the why do that; the mechanics answer questions they have not asked
yet. The cost is still shown before anyone pays: Get started opens the Chief of
Staff chat, which walks through the math and the cost, and the pay step quotes the
exact total. That keeps the 2026-10-13 call to show the seed cost up front.

The Chief of Staff card is about giving officials staff they do not have, not a
list of what it does.

## Alternatives rejected

- **Keep cost on the build card.** Rejected: it is mechanics, and the chat and the
  pay step already show it before any money is spent.
- **Rewrite item cards to the same pattern.** Not done: their headline is the item
  itself, and the priority card's text matches the priority page's "Next" line on
  purpose (Bryan, 2026-10-13).

## In their words

"This should focus on the value prop, not the mechanics of the cost. Why do I want
to build a panel? Lead with that." and "In fact, we should codify that rule across
all cards." and "Headline is the 'what' as in what value it brings, the body is the
'why'." (agent session with @bryclevgp, 2026-10-14)

"It should be more about empowering them with staff they don't have." (agent
session with @bryclevgp, 2026-10-14, on the Chief of Staff card)
