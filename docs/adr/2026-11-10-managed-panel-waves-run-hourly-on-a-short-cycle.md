---
title: Managed panel waves run hourly on a two-day lead and a 48-hour reply window, and a manual wave waits for its replies
status: superseded
decided_by: [bryclevgp]
date: 2026-11-10
code: ['#3701']
scope:
  - packages/gp-api/src/managedPanelWaves/**
  - packages/gp-api/src/outreach/services/outreachServeSmsCreate.service.ts
  - packages/gp-api/src/outreach/services/outreachResultsAdmin.service.ts
  - packages/gp-api/src/contacts/utils/managedPanelSchedule.util.ts
  - packages/gp-api/prisma/schema/managedCivicPanel.prisma
  - packages/contracts/src/people/ManagedCivicPanel.schema.ts
supersedes: []
superseded_by: 2026-11-10-managed-panel-wave-uploads-alert-before-the-backstop.md
---

# Managed panel waves run hourly on a two-day lead and a 48-hour reply window, and a manual wave waits for its replies

## Decision

The wave job runs every hour, not once a day. A wave's send date is two
days out, a Saturday or Sunday moved to the Monday (`nextManagedSendDate`),
instead of the third business day other Serve texts get. A manual wave's
replies close 48 hours after 11am local on its send date, the same 48 hours
an agent wave gets, and it then also waits for ops to upload its replies
(`ManagedPanelWave.repliesUploadedAt`, stamped by the results upload),
closing anyway three days past its window if no file comes. `nextWaveAt` is
the day the next wave goes out, projected with the same rule, rather than the
latest wave's reply close.

## Context

A panel took about four weeks to fill: three business days of lead and five
days of replies per wave, plus up to a day waiting for the morning run, and
the first wave was drawn the morning after approval, a business day later than
the date the Chief of Staff had just promised. The home card showed the reply
close as the day "more invites go out", which could be a Sunday and was days
before the real send. Replies reach the product by a manual upload, so a wave
closed on the clock alone would size and steer the next draw on a member count
missing that wave's JOINs.

## Alternatives rejected

- **Drawing the first wave from the approval request.** No request may reach
  `claimFree` (`2026-10-22-managed-panel-free-sends-and-guards.md`); an
  hourly pass keeps that and costs at most an hour.
- **Sending only on Tuesdays and Thursdays.** About a week slower across three
  waves; the product's Tuesday and Thursday advice is a tip, not a rule.
- **Closing on the 48-hour clock alone.** Oversized, mis-steered waves and
  spent free texts whenever an upload is late.
- **Rewriting the reply windows of waves already sent.** Waves in flight keep
  the window they were given; the migration marks them uploaded so none waits
  on a stamp that was never recorded.

## Revisit if

The agent path replaces manual fulfilment: the two-day lead and the upload
wait exist for ops and go with it.
