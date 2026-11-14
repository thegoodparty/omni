---
title: Win text replies are stored in PollIndividualMessage
status: active
decided_by: [agent]
date: 2026-11-13
code: ['#PR']
scope:
  - packages/gp-api/src/outreach/services/outreachInboundSweep.service.ts
  - packages/gp-api/prisma/schema/pollIndividualMessage.prisma
  - packages/gp-api/scripts/backfill-win-sms-replies.ts
supersedes: []
superseded_by:
---

# Win text replies are stored in PollIndividualMessage

## Decision

The hourly Win inbound sweep writes each received Peerly CDR row as a
`PollIndividualMessage` (`sender: CONSTITUENT`, `outreachId`, one row per
person on the replying phone), beside the `ContactInteractionText` stamps it
already writes. The id is a uuidv5 of outreach, person, the raw CDR timestamp
and the content, written with `createMany skipDuplicates`, so re-reading the
same report every hour writes nothing new and two texts in the same second
stay two rows. The sweep keeps its own phone-to-person mapping.

## Context

The sweep read Win reply text from Peerly and dropped it, so Win could show
counts but no words. Serve already stores reply text in
`PollIndividualMessage`, and the replies list, What we heard, synthesis and
the contact activity feed all read from there by `outreachId` and person.
Peerly's CDR rows carry no message id and the report is re-read whole every
pass, so the write has to be idempotent on the row's own content. Peerly
keeps reports about 90 days, so older replies are backfilled once by script.

## Alternatives rejected

- **A Win-only reply table.** Every reader would need a second source and a
  union per product.
- **Route through Serve's `OutreachTextIngestService`.** It maps phones
  through `OutreachTextRecipient` and runs civic-panel and completion logic
  Win does not have.
- **`VoterOutreachActivity`.** Deprecated and read-only.
- **Key on the CDR timestamp without content.** A person who sends two texts
  in one second would lose one.

## Revisit if

Peerly starts returning a per-message id, or Win replies move to a vendor
with a reply webhook.
