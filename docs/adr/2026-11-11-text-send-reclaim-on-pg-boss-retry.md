---
title: A text send stranded in in_progress is re-claimed by the outreachTextSend job's retry
status: active
decided_by: [swain]
date: 2026-11-11
code: ['#3726']
scope:
  - packages/gp-api/src/outreach/services/outreachTextDelivery.service.ts
supersedes: ['2026-11-11-stale-text-send-claim-reclaimed-by-stamp.md']
superseded_by:
---

# A text send stranded in in_progress is re-claimed by the outreachTextSend job's retry

## Decision

A text send runs as the `outreachTextSend` pg-boss job, grouped per outreach,
so a job that finds the row `in_progress` runs after the attempt that claimed
it died or passed its timeout. That job re-claims the row, in one
`updateMany` on the exact `Outreach.sendClaimedAt` stamp, when no recipient
rows and no hand-off row exist. Nothing waits for the claim to age. The stamp
stays for one reason: an expired attempt can still be running. Before the
Slack post a send checks it still holds its own stamp, and its hand-back and
its fail are scoped to that stamp. Null stamps and expansions are never
re-claimed.

## Context

The superseded record solved ENG-11613 (a worker killed after the claim left
the send stranded) for SQS: a redelivery could take over a claim once it was
older than the queue's visibility timeout, the point at which SQS has handed
the message to someone else. Under pg-boss the per-outreach group already
says who can hold the claim, and pg-boss retries a dead attempt within a
minute or two. The age check would refuse that retry and strand the send
again, so the SQS-era age check (`STALE_SEND_CLAIM_MS`) is removed rather
than retuned.

## Alternatives rejected

- Keep the 5-minute age and fail the job while the claim is younger. It would
  spend its attempts before the age passed and dead-letter a send that would
  have gone out.
- Drop the stamp too. An attempt past its timeout keeps running, so without a
  stamp it could post beside the retry, or fail or hand back the retry's
  claim.

## Revisit if

`outreachTextSend` stops being grouped per outreach, or a second path claims
a text send outside the job.
