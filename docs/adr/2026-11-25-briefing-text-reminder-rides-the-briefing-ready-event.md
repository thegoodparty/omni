---
title: The Meeting Briefing text reminder is a property on the briefing-ready event, sent by HubSpot
status: active
decided_by: [agent]
date: 2026-11-25
code: ['#4066']
scope:
  - packages/gp-api/src/meetings/services/meetingBriefings.service.ts
  - packages/gp-api/src/electedOffice/electedOffice.controller.ts
  - packages/gp-api/prisma/schema/electedOffice.prisma
supersedes: []
superseded_by:
---

# The Meeting Briefing text reminder is a property on the briefing-ready event, sent by HubSpot

## Decision

Olly Farshi decided on Nov 25, 2026 that the warm welcome's "Remind me" is one
text to the official when their first Meeting Briefing is ready. He has no
GitHub handle on record here, so `decided_by` is `[agent]`; how it is wired is
the agent's choice.

gp-api sends no text. It records the yes on the office
(`briefingTextReminderAt`, written by the holder through
`PUT /v1/elected-office/:id` with `briefingTextReminder`) and passes it along
on the event it already fires when a briefing is ready,
`Briefing Assistant - Agenda Created`, as the boolean `textReminder`. A HubSpot
workflow sends the text when it is true. gp-api makes it true on one event per
office, the first after the yes, by stamping `briefingTextReminderSentAt` in a
conditional write.

## Context

The product has no way to text its own users: its texting sends go to
residents from a campaign's registered number. HubSpot already sends the
"briefing ready" email off this event, so a text off the same event needs no
new path out of the product. The same meeting is briefed again on the day it
is held, and
every later meeting fires the event too, so the yes has to be spent once on
the product side rather than left to a workflow's enrollment rules.

## Alternatives rejected

- **A second event just for the text.** One briefing would fire two events
  that can drift apart; a property on the event HubSpot already receives
  cannot.
- **Send the text from gp-api.** There is no channel for product-to-user
  texts, and replies would have nowhere to go.
- **Leave `textReminder` true on every event after the yes.** The official
  asked for one text, and a workflow that re-enrolls would send one per
  briefing.

## Revisit if

The product gets its own way to text users, or officials want a text for
every briefing.
