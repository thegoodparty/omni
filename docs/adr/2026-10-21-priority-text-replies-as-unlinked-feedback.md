---
title: A priority text reply's issues are a text-channel ConstituentFeedback row with no outreachId, never confirmed
status: active
decided_by: [agent]
date: 2026-10-21
code: ['#3080']
scope:
  - packages/gp-api/src/constituentFeedback/services/constituentFeedback.service.ts
  - packages/gp-api/src/constituentFeedback/services/pendingTranscription.service.ts
  - packages/gp-api/src/priorities/services/priorityAnswerCoding.service.ts
supersedes: []
superseded_by:
---

# A priority text reply's issues are a text-channel ConstituentFeedback row with no outreachId, never confirmed

## Decision

A Serve resident's text reply to a priority's check is read for issues by
issue capture's own extraction (`voice: 'own_reply'`) and saved as a
`ConstituentFeedback` row on channel `text`, one per person per send, keyed
by `clientKey` `priority-text:<outreachId>:<personId>`. The priority answer
coding pass writes it, before it codes the yes or no. The row's
`outreachId` is null and `confirmedAt` stays null; the abandoned-confirm
sweep skips `text` rows.

## Context

The person record's "What they told us" reads `ConstituentFeedback` by
person, so a reply had to be a row there to show beside door and call memos.
But a text send's report already counts its replies as replies
(`PollIndividualMessage` members), and every effort read (report,
export, synthesis, the Chief of Staff's notes) keys on `outreachId`.
Confirmation means a person stood behind the issues, and a confirmation
without review strips them, so neither kind fits a model's reading of a
reply nobody can review.

## Alternatives rejected

- **Set `outreachId`.** Every effort read would need a `channel` filter, or
  the same words count twice; one missed read is a silent double count.
- **Confirm automatically.** Strips the issues, which is the point of the row.
- **A new confirmation kind.** Breaks "only reviewed carries issues", which
  the report, export and synthesis rely on.
- **A separate table or pipeline for reply issues.** Two extraction paths
  for one kind of record.

## Revisit if

Text replies get a review step, or an effort read needs a reply's issues
(a theme's stance split on a text send).
