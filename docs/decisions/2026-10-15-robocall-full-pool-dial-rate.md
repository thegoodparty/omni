---
title: Dial robocalls at the full CallHub pool; the serial queue, not a low per-campaign rate, prevents over_cps
status: active
decided_by: [stephtea]
date: 2026-10-15
code: ['#2821']
scope:
  - packages/gp-api/src/vendors/callhub/**
  - packages/gp-api/src/outreach/services/outreachRobocallSend.service.ts
  - packages/gp-api/src/outreach/services/outreachRobocallBacklogAlert.service.ts
supersedes: []
superseded_by:
---

# Dial robocalls at the full CallHub pool; the serial queue, not a low per-campaign rate, prevents over_cps

## Decision

Default the per-campaign CallHub dial rate (`CALLHUB_VB_CALLS_PER_MINUTE`) to 120
— the whole account pool — and keep the completion-estimate flat buffer small
(`ROBOCALL_DIAL_ESTIMATE_BUFFER_MINUTES` = 30), for throughput. The thing that
prevents `over_cps` contention is the strictly-serial send queue (one campaign
dials at a time), not a low per-campaign rate. Do not lower the rate back toward
a "share the pool" value, and do not replace the proportional ÷2 completion
haircut (`ROBOCALL_DIAL_SAFETY_RATE_DIVISOR`) with a flat-pad-only model.

## Context

CallHub shares one ~120 calls/min Voice Broadcast pool across RUNNING campaigns.
Before the serial queue, several campaigns dialed at once and a low per-campaign
rate (10) was needed to avoid `over_cps_limit`. Under the now-serial queue that
low rate made big lists dial slowly, each holding the shared pool for hours and
stacking sends overdue (the Oct 15 backlog). The rate climbed 10 → 30 → 120 and
the flat completion buffer was cut 180 → 30 as the serial model removed the
contention that forced them small.

## Reasoning

The serial sweep dials exactly one campaign at a time, so a single run can own
the whole pool with nothing of ours to contend with. R1 freezes each run's rate
at staging and the completion ceiling walks that frozen rate at the ÷2 ratio, so
a faster rate shortens a new run's estimate in step and never mis-frees an
in-flight run. The Oct incident confirmed PAUSED campaigns do not consume the cap
(leroy ran at 60 while others sat Paused at 60). A live PATCH confirmed CallHub
accepts frequency 120 on a campaign. A stray `over_cps` self-heals via
`startCampaign`'s throttle revert. The ÷2 haircut is the PROPORTIONAL money-safety
(it covers an up-to-2× real-vs-configured slowdown and scales with list size); the
flat buffer only has to absorb startup/tail slack, so 30 is enough.

## Alternatives rejected

- Keep a low "shared pool" rate (10–30): leaves throughput on the table and
  recreates the overdue backlog; the contention it guarded against no longer
  exists under serial.
- Raise above ~120: not a code change — it exceeds the account cap and requires
  CallHub to raise it (support@callhub.io, billed monthly).
- Flat-pad-only completion margin (drop the ÷2 divisor, rely on a constant pad):
  under-covers a large list, because the slowdown is proportional to dial time —
  a 2× slowdown on a 7.5k-call run is ~60 min, more than any flat pad we would
  set. Freeing early aborts a still-dialing run → under-deliver + full 48h charge,
  the exact failure the haircut exists to prevent.

## In their words

"ok if we are going serial, can we up all to 120 moving forward?" and, on the
buffer, "seeing if we can relax the buffer to get more throughput" / "maybe we
just pad it to 30 minutes, not 1.5x time." — agent session with @stephtea,
2026-10-15. (The literal "not 1.5× time" — dropping the rate haircut — was walked
back to "keep the ÷2 haircut, cut the flat buffer to 30" once it was clear a flat
pad alone under-covers a large list; see Alternatives rejected.)

## Revisit if

The serial send sweep is ever relaxed to run more than one campaign concurrently
(bounded parallelism), or CallHub raises or lowers the account pool — at which
point the per-campaign rate and the completion margins must be re-derived against
how many run at once.
