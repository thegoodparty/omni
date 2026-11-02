---
title: A Win SMS send moves to a replacement Peerly job by repointing the same Outreach row, keeping one live job and its list
status: active
decided_by: [agent]
date: 2026-11-02
code: ['#PR_NUMBER']
scope:
  - packages/gp-api/src/outreach/services/outreachSmsAdmin.service.ts
  - packages/gp-api/src/outreach/outreachSmsAdmin.controller.ts
  - packages/gp-api/prisma/schema/outreach.prisma
  - packages/gp-admin/src/app/dashboard/sms-outreach/**
supersedes: []
superseded_by:
---

# A Win SMS send moves to a replacement Peerly job by repointing the same Outreach row, keeping one live job and its list

## Decision

When CAS needs a p2p send on a different Peerly job, the console swaps
`Outreach.projectId` on the same row and keeps the old id in
`previousJobId`, with a reason from a fixed list. Either the console
replaces the job before the send goes out (a new job from what the row
stores, on the row's existing Peerly list, with the old job canceled
first or the new one removed), or it links a job staff already made by
hand in Peerly, once the old job is spent or gone. A send always ends with
one live job. `phoneListId` never changes, and nothing about the payment
does. `projectId` is therefore not fixed for the life of a row, and code
keyed on the job reads it when it runs.

## Context

2026-11-02: Peerly found a job's sending number was bad, disabled it, and
asked CAS to clone the job, re-upload the list and request canvassers.
Peerly counted the texts as sent. CAS cloned it by hand, which left our
row on the dead job. The completion sweep, inbound sweep, console listing
and Slack notices all read the job through `projectId`.

Prod logs show a Peerly list can sit on more than one job, each starting
with the list's full lead count and draining on its own (a list assigned
to two jobs in October delivered on both). So the list is reused, not
rebuilt.

## Alternatives rejected

- **A new Outreach row per job.** Splits one paid send across rows: the
  payment, the satellite, materialized interactions and the candidate's
  history would sit on the old row while the job and sweeps follow the new.
- **Duplicate: a second live job beside the first.** Every job-keyed
  reader follows one `projectId`, so the extra job's replies and status
  would be lost, and voters on the list could get the text twice.
- **Re-uploading the list, as Peerly suggested.** Our CSV needs names and
  addresses we do not keep per recipient, so it means re-running the async
  voter-file build: minutes to ready, a deferred job create, and an
  audience that can drift from the count the candidate paid for.
- **Peerly's clone endpoint.** Docs do not say what it copies (lists,
  schedule, media), and the existing create path is tested.

## Revisit if

Peerly confirms a reused list does not deliver on a new job, or CAS needs
two live jobs for one send.
