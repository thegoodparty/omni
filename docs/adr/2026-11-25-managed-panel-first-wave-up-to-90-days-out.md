---
title: A managed civic panel's first wave goes out on the day the official picks, from tomorrow to 90 days out
status: active
decided_by: [agent]
date: 2026-11-25
code: ['#4066']
scope:
  - packages/gp-api/src/managedPanelWaves/**
  - packages/gp-api/src/outreach/services/outreachServeSmsCreate.service.ts
  - packages/gp-api/src/contacts/services/managedCivicPanel.service.ts
  - packages/gp-api/src/contacts/utils/managedPanelSchedule.util.ts
  - packages/gp-api/prisma/schema/managedCivicPanel.prisma
  - packages/contracts/src/people/ManagedCivicPanel.schema.ts
supersedes: [2026-11-17-managed-panel-first-wave-on-the-chosen-day.md]
superseded_by:
---

# A managed civic panel's first wave goes out on the day the official picks, from tomorrow to 90 days out

## Decision

Everything in the record this supersedes stands, and through it the record
before (the hourly job, the 48-hour reply window, waiting on a manual wave's
upload, the daily stall alert and the five-day backstop), except how far ahead
the first wave's day can be. The approval carries `firstSendDate`, a day from
tomorrow to `MANAGED_PANEL_FIRST_SEND_MAX_DAYS` (90) out, never a weekend,
stored on `ManagedCivicPanel.firstSendDate`. The limit is the managed panel's
own, exported from contracts so the webapp's picker reads the same number.
Every other send keeps `MAX_SERVE_SMS_SCHEDULE_DAYS` (30).

The job still draws nothing until the day before the chosen day, then dates
the first wave on it: a manual wave gets that day, an agent wave 11am local
that day. Once the day has passed, every wave takes the two-day lead. A panel
approved with no date starts two days out. A panel waiting on its day has no
wave, so the stall alert and the backstop, which act on a sent wave, cannot
fire during the wait.

Olly Farshi, who owns the Serve welcome's design, decided this on 2026-11-25.
Bryan Levine (`bryclevgp`) decided the record this supersedes and has not yet
agreed to the change. His agreement is being sought in the PR.

## Context

The Serve welcome asks a candidate who has just won to set up their civic
panel, and offers "After I'm sworn in" as the day the first invites go out.
The warehouse's local terms that began in the four months after the November
2024 election start more than 30 days after election day 96 times in 100,
with a median of 57 days. Under the 30-day limit that choice was refused for
nearly every winner who went through the welcome in the weeks after a win.

## Alternatives rejected

- **Raise the limit for every send.** Polls and Serve texts are paid sends
  that ops schedules, and nothing asked for them to be booked further ahead.
- **Keep 30 days and ask the official to come back.** The welcome is seen
  once, and a panel nobody returns to set up is never built.
- **No upper limit.** A mistyped year would hold a panel for good. Ninety
  days covers a term that starts in January after a November election.
- **Approve now and hold the date in the webapp.** Rejected in the record
  this supersedes, for the same reason: the approval is the consent, and a
  date only the browser knew could not reach the job.

## Revisit if

Manual fulfilment ends: the weekend rule and the two-day lead on later waves
exist for ops. Or offices routinely take their seats more than 90 days after
they win.
