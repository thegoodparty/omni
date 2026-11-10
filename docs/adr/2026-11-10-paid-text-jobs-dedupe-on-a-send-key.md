---
title: Paid text sends and phone list builds dedupe on a pg-boss send key
status: active
decided_by: [agent]
date: 2026-11-10
code: ['#PR']
scope:
  - packages/gp-api/src/outreach/util/outreachTextSendJob.util.ts
  - packages/gp-api/src/outreach/services/outreachTextSendJob.service.ts
  - packages/gp-api/src/vendors/peerly/services/p2pPhoneListUpload.service.ts
  - packages/gp-api/src/outreach/services/outreachP2pSms*.service.ts
supersedes: []
superseded_by:
---

# Paid text sends and phone list builds dedupe on a pg-boss send key

## Decision

The `outreachTextSend` job is sent with `sendMany`, keyed on
`<outreachId>:<sendSeq>` and grouped per outreach, by every producer. The
`p2pPhoneListBuild` job is keyed on `<buildId>:attempt-<n>` and grouped per
build. The key replaces the SQS deduplication id: a second send of the same
pair while the first job is queued or running is dropped, and the group keeps
two jobs for one send from running at once, which the delivery layer's claim
revert relies on. The CAS claims stay the guarantee against a second text
batch or charge; the key only saves the duplicate work.

`outreachTextSend` keeps `agentHandoff` (`mode`, `sendAt`, `timeZone`) in its
payload, the one non-id field. It is the managed wave's agent plan, decided
when the wave is claimed and stored nowhere until delivery writes the hand-off
row from it, and it carries no PII.

The P2P money sweeps (capture, stranded refunding, denied release, stranded
authorized) fan out one job per hold, each re-reading its row through the
sweep's filter. The completion, inbound, opt-out reconcile, build reclaim,
build finish and hand-off overdue sweeps stay one job per run.

## Context

SQS FIFO deduplication collapsed the duplicate sends of the Stripe
webhook/redirect race, a resumed managed wave claim and a reclaimed build
attempt. pg-boss has no dedup id on `send`; `sendMany` derives the job id from
a key. The fanned-out sweeps move money behind per-row claims, so a row can
fail, retry and dead-letter on its own. The others only read vendors: a failed
row must log and be read again next pass rather than page (a Peerly job gone
upstream fails every hour), and inbound and opt-out reconcile report pass-wide
counts.

## Alternatives rejected

- Plain `send` with no key: correct under the CAS claims, but a duplicate
  could be queued behind a running send.
- Storing the agent plan on the wave row so the payload is ids only: a schema
  change for three non-sensitive values that are frozen at claim time.
- Re-deriving the agent plan in the worker: a flag flip between claim and send
  could leave a wave with neither a hand-off row nor a reply window.
- Fanning out every sweep: per-row dead letters would page on vendor reads
  that are expected to fail, and lose the pass-wide counts.
