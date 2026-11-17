---
title: A managed civic panel's first wave goes out on the day the official picks, as early as tomorrow
status: active
decided_by: [bryclevgp]
date: 2026-11-17
code: ['#PR']
scope:
  - packages/gp-api/src/managedPanelWaves/**
  - packages/gp-api/src/outreach/services/outreachServeSmsCreate.service.ts
  - packages/gp-api/src/contacts/services/managedCivicPanel.service.ts
  - packages/gp-api/src/contacts/utils/managedPanelSchedule.util.ts
  - packages/gp-api/prisma/schema/managedCivicPanel.prisma
  - packages/contracts/src/people/ManagedCivicPanel.schema.ts
supersedes: [2026-11-10-managed-panel-wave-uploads-alert-before-the-backstop.md]
superseded_by:
---

# A managed civic panel's first wave goes out on the day the official picks, as early as tomorrow

## Decision

Everything in the record this supersedes stands (the hourly job, the 48-hour
reply window, waiting on a manual wave's upload, the daily stall alert and the
five-day backstop) except the first wave's date. The approval carries
`firstSendDate`, a day from tomorrow to 30 days out, never a weekend, stored on
`ManagedCivicPanel.firstSendDate`. The job draws nothing until the day before
it, then dates the first wave on it: a manual wave gets that day, an agent wave
11am local that day. Once the day has passed, every wave takes the two-day lead
as before. A panel approved with no date starts two days out.

## Context

An official elected but not yet sworn in needs the invites to start after they
take office, and the approval used to start them at once. A one-day lead is
safe now because the panel waves' agent hand-off sends them without ops
scheduling each by hand. Weekends stay closed because a manual wave still needs
ops that day.

## Alternatives rejected

- **Draw at approval and only hold the send.** A list drawn weeks early reads
  the district as it was then, and the members joined since would not steer it.
- **A one-day lead on every wave.** Only the first wave waits on the
  official's choice; later waves keep the cadence the panel was sized for.
- **Holding the first wave in the webapp.** The approval is the consent, and a
  date only the browser knew could not reach the job.

## Revisit if

Manual fulfilment ends: the two-day lead on later waves exists for ops.
