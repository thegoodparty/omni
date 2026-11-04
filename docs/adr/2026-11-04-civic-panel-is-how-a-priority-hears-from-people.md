---
title: A priority hears from people through the civic panel, set up from the thread when there is none
status: active
decided_by: [bryclevgp]
date: 2026-11-04
code: ['#PR']
scope:
  - packages/gp-api/src/chats/general/priority-flow/priorityFlow.prompt.ts
  - packages/gp-api/src/chats/general/priority-flow/priorityFlow.handler.ts
  - packages/gp-api/src/chats/general/chief-of-staff/services/managedCivicPanel.tools.ts
  - packages/gp-webapp/app/dashboard/priorities/[priorityId]/components/PriorityWorkspace.tsx
supersedes:
  - 2026-10-29-ready-civic-panel-is-a-prioritys-default-first-round.md
superseded_by:
---

# A priority hears from people through the civic panel, set up from the thread when there is none

## Decision

Behind `serve-citizen-panels`, a warranted check in the priority chat is
recommended and started, never asked about, and on Your options it is
warranted by default. The office's managed civic panel is how it goes out.
Ready: the agent presents the card to ask it, with no choice of paths.
Building or paused: it records the check deferred until the civic panel is
ready. None: the priority handler registers the Chief of Staff's civic
panel tools (`buildManagedCivicPanelTools`, without reach the rest) and the
thread runs the same set up, with the same fixed words, and defers the
check to the ready week. The round one text and calls or doors are built
only when the official asks, or when the civic panel is exhausted.

The handler keeps reading the managed civic panel once per open, but no
longer caches a null, so the turn after the official approves the invite
reads it as building.

## Context

An official with no civic panel, at the options step, was asked whether to
send any outreach and then given the paid round one text. Bryan decided on
2026-11-04 that the chat should get them a civic panel instead, exactly as
the Chief of Staff does, and that a ready civic panel is asked without a
choice of paths.

## Alternatives rejected

- Keep the three-way choice for a ready civic panel. It brings back the
  question this change removes.
- Send the official to Build my civic panel on the home. It drops them out
  of the priority at the moment they want an answer.
- New set up tools for the priority chat. Two copies of the approved
  explanation and invite flow would drift.

## Revisit if

Officials with a civic panel still building want a faster read than waiting
for it.
