---
title: Panel waves with handler api send through the Scale to Win API
status: active
decided_by: [tomer-tgp]
date: 2026-11-23
code: []
scope:
  - packages/gp-api/src/outreach/util/textDeliverySlack.util.ts
  - packages/gp-api/src/managedPanelWaves/AGENTS.md
  - docs/features/serve-sms.md
supersedes: []
superseded_by:
---

# Panel waves with handler api send through the Scale to Win API

Supplements the agent hand-off decision
(`2026-11-02-managed-panel-waves-hand-off-to-a-swarm-agent.md`, carried on by
`2026-11-03-the-delegate-swarm-holds-no-gp-api-credential.md`). It supersedes
neither: the agent path stays for `handler: agent` rows.

## Decision

For a hand-off row with `handler: api`, gp-api builds and sends the wave
through the Scale to Win Text API. A sweep job does the work (ENG-11747, not
yet shipped). The hand-off post in Slack stays as the audit trail: its machine
block carries `handler: api`, has no `repliesKey`, and its note says gp-api is
building the wave. The browser runner never builds an api wave. It only exports
the replies at `sendAt` + 48 hours, after confirming in Scale to Win that the
campaign shows as sent. The sweep names each campaign with `#<outreachId>`,
the same way the runner names the campaigns it builds, so the runner finds it
by that search. The Delegate swarm detects hand-offs by the agent note, so it
does not pick up an api post at all until it learns the api note.

## Context

The Slack hand-off port already tells the runner and fulfilment staff what to
do with a wave. Without a marker, the runner would treat an api post as an
agent wave and build the same campaign by hand, which risks a double send.

## Alternatives rejected

- **Stop posting to Slack for api waves.** Loses the one place staff and the
  runner already watch, and the audit trail with it.
- **Let the runner infer the handler** from the campaign id or the missing
  `repliesKey`. An implicit signal breaks quietly; a named `handler` line does
  not.

## Revisit if

The runner is retired, or the Scale to Win API can export replies itself, so
the 48-hour export no longer needs a browser.
