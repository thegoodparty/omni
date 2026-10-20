# src/priorities/

An elected official's priorities: the record, the agent's seven-step status
(`Priority.status`, parsed only through contracts `parsePriorityStatus`), and
the results page's read of who answered the outreach sent on one
(`services/priorityResults.service.ts`).

## Answer coding

`services/priorityAnswerCoding.service.ts`. Replies stay free text; an AI
classifier codes each respondent's answer to the send's question as `yes`,
`no`, `mixed` or `not_an_answer`, one `PriorityAnswer` row each (staff spot
check them). The read status models them (below). Storing codes is
invisible, so it is not flag-gated.

- **Which sends.** The ones `PriorityResultsService` counts: a priority
  linked, `campaignId` null, gone out, and a text, a phone list or a walk.
- **Who and what words.** The same respondents the results page counts. A
  text's are the person's `CONSTITUENT` replies, opt-outs left out, joined
  oldest first. A call's or a knock's is the `ConstituentFeedback.transcript`
  on that answered interaction. An answered door or call with no words is
  never coded.
- **The question.** The check the send put out: `priorityStepId`'s step,
  `check.question`, or `check.contrast.question` when `priorityCheckSide` is
  `contrast`. A send with no check, or an empty question, falls back to what
  the resident was asked on that channel: the text's `message`, or the
  turf's or list's `communityInputQuestion`. With neither it is skipped.
- **Idempotency.** Upsert on `(organizationSlug, source, sourceId)`;
  `sourceId` is `<outreachId>:<personId>` for a text, the interaction id for a
  call or knock. A row is due again only when its source was written after
  `codedAt` (a reply's or the memo's `updatedAt`), a proxy for the words
  changing: confirming a memo codes it once more, and so does a re-upload
  that rewrites the replies in place.
- **The model.** `LlmService.jsonCompletion`, 20 replies a call, each sent
  under its position in the batch, never a person id. A failed call or an
  off-vocabulary code leaves those replies uncoded for the next pass.
- **When.** Fire-and-forget after a committed results upload on a Serve text
  (`outreachResultsAdmin.service.ts`), and after a memo is captured or
  confirmed (`constituentFeedback.service.ts`). The backstop is the
  `priorityAnswerCodingSweep` cron (`6,16,...,56` past the hour,
  `CronLockService` ten-minute slot), over priority sends created in the last
  30 days. It reads before it claims. No deploy allowlist: it calls the model
  only for replies on its own database.

## The read

`PriorityResultsService` decides a priority's good read from an MRP model
of its coded answers (`util/mrp.util.ts`), mapped to the page's existing
`PriorityReadStatus` by `util/mrpReadStatus.util.ts`. The rule, the major
groups and `needed` are in the webapp's priority AGENTS.md ("A good read")
and `docs/features/civic-panel-mrp.md`. The frame and the answer cells come
from `CensusCompositionSource.mrpInputs` (bound in
`CensusCompositionModule`; route tests stub it). `codedAnswers` reads
`PriorityAnswer` over the same sends the page counts, one value per person.
The representation bars compare who answered with the district, unweighted.
