---
title: A managed wave's agent replies arrive through an S3 event on the main queue
status: active
decided_by: [agent]
date: 2026-11-03
code: ['#3556']
scope:
  - packages/gp-api/deploy/components/panel-replies-ingest.ts
  - packages/gp-api/src/outreach/services/outreachPanelReplies.service.ts
  - packages/gp-api/src/queue/consumer/**
supersedes: []
superseded_by:
---

# A managed wave's agent replies arrive through an S3 event on the main queue

## Decision

The swarm hands a wave's replies to gp-api by writing the Scale to Win export to
`agent-replies/<outreachId>.csv` in the tevyn bucket. S3 sends the object event
to EventBridge, a rule forwards it to the existing FIFO queue as a
`panelRepliesUploaded` message, and the queue consumer ingests it. gp-api holds
no endpoint or credential for the swarm, which only needs `s3:PutObject` on that
prefix through the bucket policy. EventBridge cannot set a FIFO deduplication
id, so the main queue uses content-based dedup and the rule puts the event id in
the body. The handler is idempotent end to end, so the at-least-once delivery of
S3 events and SQS needs no dedup of its own.

## Context

The swarm had called gp-api with its own auth tier to submit replies and report
its send. That tier was removed (`2026-11-03-the-delegate-swarm-holds-no-gp-api-credential.md`).
The swarm still has to say when replies are in and what time the wave really
went out, and the export carries both: outbound rows' `Sent At` give the send
and the inbound rows are the replies.

## Alternatives rejected

- **A gp-api endpoint the swarm calls.** Brings back the credential and auth
  tier just removed.
- **A new queue or a Lambda on the bucket.** One queue switching on `QueueType`
  is the repo's rule, and a Lambda adds a deploy unit for a message shape.
- **A bucket notification straight to SQS.** The body is S3's record format,
  not our `{type, data}` envelope, and a FIFO queue cannot be a direct S3
  target. EventBridge's input transformer builds our envelope.
- **Polling the bucket from the daily job.** Adds hours of latency to closing a
  wave and a scan with no event to key on.

## Revisit if

The swarm moves to a different export source, or a second producer needs the
same bucket and the `agent-replies/` prefix stops being unique to one.
