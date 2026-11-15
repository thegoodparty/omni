---
title: A managed panel wave waiting on its upload alerts ops daily from two days past its window, and closes on its own at five
status: active
decided_by: [bryclevgp]
date: 2026-11-10
code: ['#3703']
scope:
  - packages/gp-api/src/managedPanelWaves/**
  - packages/gp-api/src/outreach/services/outreachServeSmsCreate.service.ts
  - packages/gp-api/src/outreach/services/outreachResultsAdmin.service.ts
  - packages/gp-api/src/contacts/utils/managedPanelSchedule.util.ts
  - packages/gp-api/prisma/schema/managedCivicPanel.prisma
  - packages/contracts/src/people/ManagedCivicPanel.schema.ts
supersedes: [2026-11-10-managed-panel-waves-run-hourly-on-a-short-cycle.md]
superseded_by:
---

# A managed panel wave waiting on its upload alerts ops daily from two days past its window, and closes on its own at five

## Decision

Everything in the record this supersedes stands: the job runs hourly, a wave
sends two days out (a weekend moved to the Monday), replies close 48 hours
after 11am local on the send date, a manual wave also waits for ops to upload
its replies (`repliesUploadedAt`), and `nextWaveAt` is the day the next wave
goes out. What changes is what happens when the upload does not come. Two
days past the window the job posts to `#bot-tevyn-api`, then at most once a
day (`ManagedPanelWave.stallAlertedAt`) until the upload lands. Five days past
the window, not three, the wave closes anyway and posts that it did. A wave
nobody answered is uploaded as a file of only its outbound rows, which the
results upload accepts for a wave and still refuses for any other send.

## Context

A closed-on-the-clock wave with a late upload undercounts members, so the
next wave is drawn too big and steered wrong. Closing quietly three days in
hid a missed upload from the team. Ops needs to see a stall well before the
backstop, without a post every hour, and needs a way to close a wave that got
no replies, since the upload refused a file with none.

## Alternatives rejected

- **No backstop, alerts only.** A wave nobody answered, or an alert missed,
  would hold the panel until an engineer stepped in.
- **Alerting the hour the window closes.** Most uploads land within a day;
  that alert is noise, not a stall.
- **A separate scheduled job for the alert.** The hourly wave job already
  reads every open wave; a second job would read the same rows.

## Revisit if

The agent path replaces manual fulfilment: the upload wait, the alert and the
backstop exist for ops and go with it.
