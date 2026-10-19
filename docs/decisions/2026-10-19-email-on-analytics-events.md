---
title: Frontend analytics events carry the user's email so HubSpot can join them
status: active
decided_by: [bryclevgp]
date: 2026-10-19
code: [59c392f315]
scope:
  - packages/gp-webapp/helpers/analyticsHelper.ts
supersedes: []
superseded_by:
---

# Frontend analytics events carry the user's email so HubSpot can join them

## Decision

`trackEvent` keeps adding the signed-in user's `email` as a property on every
frontend analytics event. Do not remove it as a PII cleanup.

## Context

An agent reviewing analytics for the Serve civic panel flagged that every
event sends the user's email as an event property, which reads as personal
data in analytics. The email property was removed once before and restored in
59c392f315.

## Reasoning

HubSpot joins Segment events to its contact records on email. Without it, the
events can't be matched to the person in HubSpot.

## Alternatives rejected

- **Drop email from event properties as PII.** Rejected: it breaks the join
  against HubSpot records.

## In their words

"No, we need it to join against Hubspot records in Hubspot. Record that as a
decision." (agent session with @bryclevgp, 2026-10-19)
