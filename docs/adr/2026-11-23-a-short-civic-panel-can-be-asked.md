---
title: A civic panel that ran out of texts can be asked, with one warning that it is short of its goal
status: active
decided_by: [bryclevgp]
date: 2026-11-23
code: ['#4019']
scope:
  - packages/gp-api/src/chats/general/priority-flow/priorityFlow.prompt.ts
  - packages/gp-api/src/chats/general/priority-flow/priorityFlow.handler.ts
  - packages/gp-api/src/chats/general/chief-of-staff/services/chiefOfStaffPrompt.ts
  - packages/gp-api/src/priorities/services/priorityResults.service.ts
  - packages/gp-api/src/dashboardCards/services/dashboardCards.service.ts
  - packages/contracts/src/priorities/PriorityResults.schema.ts
  - packages/gp-webapp/app/dashboard/priorities/[priorityId]/**
  - packages/gp-webapp/app/dashboard/contacts/citizens-panel/**
supersedes:
  - 2026-11-04-civic-panel-is-how-a-priority-hears-from-people.md
superseded_by:
---

# A civic panel that ran out of texts can be asked, with one warning that it is short of its goal

## Decision

Behind `serve-citizen-panels`, a warranted check in the priority chat is
recommended and started, never asked about, and on Your options it is
warranted by default. The office's managed civic panel is how it goes out.
Ready: the agent presents the card to ask it, with no choice of paths.
Building or paused: it records the check deferred until the civic panel is
ready. None: the priority handler registers the Chief of Staff's civic
panel tools (`buildManagedCivicPanelTools`, without reach the rest) and the
thread runs the same set up, defers the check to the ready week.

Exhausted (every texting wave went out, short of the goal) with at least
`PANEL_MIN_MEMBERS_FOR_BALANCE` (30) members: the agent treats it like a
ready one and says once that it is short of its goal, so what they hear may
not reflect all of their place. Trying to fill it means running the full
text waves; whether to keep filling it at the door or on calls is the
official's call. Under 30 members, an exhausted civic panel keeps the round
one text first and is asked only when the official asks.

A read short of good whose every send went to such a civic panel is not
held back: the read status carries `shortCivicPanel`, the results page
shows its themes and groups under the same warning with Get answers, and
the agent may share what came back after saying it. The warning is worded
the same on the civic panel page and the Constituents section (an info
`Alert`), Where this stands, the results page, the Chief of Staff home card
and both agents.

## Context

An official's civic panel ran through every wave with over 200 members and
fell short of its goal. The product pointed them at doors and calls, and
the paid round one text, before they could ask the residents who had
already said yes. Bryan decided on 2026-11-23 that hearing from someone is
better than hearing from no one, as long as the official is told plainly
that it is short.

## Alternatives rejected

- Ask the civic panel only when the official asks, as before. It leaves a
  civic panel of hundreds unused by default.
- Hold back what a short civic panel heard until every group fills. A
  civic panel that has run out of texts may never fill every group.
- Require door knocking or calls before it can be asked. It puts a chore
  between the official and residents who already said yes.

## Revisit if

Officials act on a short civic panel's answers as if they spoke for the
district, or exhausted civic panels under 30 members turn out to be common.
