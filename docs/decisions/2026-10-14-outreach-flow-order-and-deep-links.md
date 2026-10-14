---
title: Text flows ask for the message before the date, and outreach from a chat card opens the standard flow at the step its context calls for
status: active
decided_by: [bryclevgp]
date: 2026-10-14
code: ['#2746', '#2752']
scope:
  - packages/gp-webapp/app/dashboard/outreach/v2/**
  - packages/gp-webapp/app/dashboard/shared/agent-chat/cards/**
  - packages/gp-webapp/app/dashboard/constituent-outreach/**
supersedes: []
superseded_by:
---

# Text flows ask for the message before the date, and outreach from a chat card opens the standard flow at the step its context calls for

## Decision

Every text flow, on Win and Serve and from every entry point, runs purpose, audience, message, date, then review and pay. Outreach started from a chat card (Campaign Manager or Chief of Staff: a priority check, a report back, the civic panel invite, phone banking) opens that same standard flow, with every step and normal back and forward navigation, at the most appropriate step for what the card already settled: usually the message step with the purpose chosen, the card's list saved and selected and the agent's message loaded; the audience step when who gets it still needs choosing. No trimmed flow, no audience summary banner.

## Context

Cards first opened the list builder with the audience pre-filled as filters, which left officials unsure what they were looking at. #2738 then made cards open a trimmed "ready to send" flow with steps removed, a summary banner above the message, and Back exiting the flow. #2746 replaced that with the standard flow landing on the message step, and put the message before the date for card-opened texts, which made them differ from texts started elsewhere.

## Reasoning

The trimmed flow looked and behaved differently from every other outreach flow. Officials and candidates should see the one flow they already know, starting where the card left off, and be free to go back and change anything. Choosing a date before the message is backwards, so every text flow asks for the message first.

## Alternatives rejected

- Open the filter builder pre-filled: confusing, with no way to tell where the count came from.
- The trimmed ready-to-send flow with a summary banner (#2738): a different flow for the same job, and it broke normal navigation.
- Keep the date before the message on texts started from the outreach page: two orders for the same flow.

## In their words

"I want to use the same old outreach flows, let the person move back and forward, etc. It should deep link to the compose screen" and "Make that decision apply to Win" and "It's weird to pick a date before I pick my message. Let's make this universal for all SMS flows." and "it should deep link to the most appropriate place based on the context" (agent session with @bryclevgp, 2026-10-14)
