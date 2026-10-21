---
title: The issue-capture flag's 404 carries ISSUE_CAPTURE_OFF, and the offline queue keeps memos on it
status: active
decided_by: [agent]
date: 2026-10-21
code: ['#PR']
scope:
  - packages/gp-api/src/constituentFeedback/constituentFeedback.controller.ts
  - packages/gp-webapp/app/dashboard/shared/dictation/useOfflineMemo.ts
  - packages/contracts/src/constituentFeedback/**
supersedes: []
superseded_by:
---

# The issue-capture flag's 404 carries ISSUE_CAPTURE_OFF, and the offline queue keeps memos on it

## Decision

Every issue-capture route still answers 404 while the `issue-capture` flag is
off for the user, but the body carries `errorCode: ISSUE_CAPTURE_OFF`
(`ISSUE_CAPTURE_OFF_ERROR_CODE` in contracts). The webapp's offline queue
treats that 404 as "not now": the memo stays on the phone and is sent once
the flag answers on. Every other 404 with a reason is still a refusal, and the
memo is dropped, so a memo refused for its own reason ("Stop target not
found") never blocks the queue for good.

## Context

A phone with no signal holds a knock and its recorded memo in IndexedDB and
sends them when signal returns. The queue dropped any 400, 403, 404, 409 or 422
that came with a reason, because those repeat on every drain. The flag gate
answered a bare 404, and `FeaturesService` fails closed, so an Amplitude it
cannot reach reads as off. A kill switch or an Amplitude outage therefore
deleted every memo a canvasser was holding, which is the dead-zone promise
the offline path exists to keep. Knocks are not flag-gated and drain before
memos, so holding a memo never holds a knock.

## Alternatives rejected

- **503 for off and unreadable.** The queue already retries 5xx, but every
  5xx counts toward the controller's generated route alert, so turning the
  flag off would page on designed behavior. It would also stop the reads
  answering 404, which the controller chose so a surface a user is not
  rolled out to does not advertise itself.
- **502 only when Amplitude cannot be reached** (`BadGatewayException`, per
  gp-api's exception rules). Correct for the outage, but a flag turned off
  would still delete held memos, and it needs a second evaluation path in
  `FeaturesService`. Zero evaluation failures were logged on prod or dev in
  the 7 days to 2026-10-21, so the outage alone did not justify it.
- **Client-side: keep any memo 404 for a few days.** No server change, but it
  keeps genuine refusals for days too, and loses the memos anyway when a kill
  switch outlasts the window.

## Revisit if

The feature is retired. Its routes then 404 without the code, so held memos
drop, which is the intended end state.
