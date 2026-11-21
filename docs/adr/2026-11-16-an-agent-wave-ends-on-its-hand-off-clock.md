---
title: An agent-handled panel wave ends on its hand-off clock like a manual one, and the hand-off alarm ends with the wave
status: active
decided_by: [agent]
date: 2026-11-16
code: ['a96c10f7e63ad24bddd6d79fd9cde949e7289be3']
scope:
  - packages/gp-api/src/managedPanelWaves/**
  - packages/gp-api/src/outreach/services/outreachTextHandoff.service.ts
  - packages/gp-api/src/outreach/observability/managedPanelHandoff.metrics.ts
---

# An agent-handled panel wave ends on its hand-off clock like a manual one, and the hand-off alarm ends with the wave

## Decision

An agent wave's reply window is dated from its `OutreachTextHandoff.sendAt` plus
`MANAGED_WAVE_REPLY_HOURS` whenever the wave's own `replyWindowEndsAt` is still
null, so the manual path's daily stall notice (two days past the window) and its
close (five days past) reach an agent wave too; the swarm's export still replaces
that window with the real send time when it lands. The overdue sweep counts only
flagged rows whose wave is still open, so the `needs_human` alarm fires while the
wave is open and stops when its replies land or the wave closes without them.
This extends `2026-11-10-managed-panel-wave-uploads-alert-before-the-backstop`,
which left the agent path out.

## Context

The agent path had one end: the export. A wave whose swarm never reported it
stayed `waiting` on every hourly run with a null window, and the manual stall
notice and backstop were skipped for it because `awaitingUpload` required no
hand-off row. Prod held a panel that way for three days while the 15-minute
hand-off sweep added that row to a counter every run, paging with no state that
could ever be cleared. gp-api cannot distinguish "the export is late" from "the
wave was never sent": ENG-11568 (`71be3b5a74`) deleted the swarm's report routes,
so the replies CSV is the only inbound signal.

## Alternatives rejected

- **Keep waiting for the export, alert only.** Already the behaviour, and it
  holds the panel open for good on a wave nobody sent.
- **Restore the swarm's report routes.** The real removal, and the follow-up; it
  needs a credential tier and a swarm-side write, so it cannot make the panel
  end today.
- **Close the wave at the alarm instead of the wave job.** Two owners of one
  lifecycle; the wave job already holds every other step of it.

## Revisit if

The swarm reports terminal state (sent, not sent, gave up) instead of only
uploading an export: the clock, the stall notice and the backstop then become
the fallback rather than the detector.
