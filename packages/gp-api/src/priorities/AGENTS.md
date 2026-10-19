# src/priorities/

An elected official's priorities: the record, the agent's seven-step status
(`Priority.status`, parsed only through contracts `parsePriorityStatus`), and
the results page's read of who answered the outreach sent on one
(`services/priorityResults.service.ts`).

## Answer coding

`services/priorityAnswerCoding.service.ts`. Replies stay free text; an AI
classifier codes each respondent's answer to the send's question as `yes`,
`no`, `mixed` or `not_an_answer`, one `PriorityAnswer` row each (staff spot
check them; nothing reads the codes yet). Storing codes is invisible, so it
is not flag-gated.

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

## Round 2 draw

`services/priorityRoundTwoDraw.service.ts`. A priority's round 2 text is
paid for at setup and drawn later: the `priorityRoundTwoDraw` cron
(`41 7 * * *` ET, `CronLockService` daily slot, reads before it claims)
draws every paid send whose list is still an undrawn sample and whose send
date is on or before `roundTwoDrawCutoff` (three business days out, the last
day a Serve text for that date could be booked).

- **Claim.** A CAS stamping the list's `sampledAt` where it is null. A
  failure before the enqueue lands deletes the members and clears it again.
- **Fit.** The priority's coded answers (`yes` 1, `no` 0, `mixed` 0.5,
  `not_an_answer` out), placed by `CensusCompositionSource.weightingInputs`
  once per code, against a frame of the census shares
  (`util/roundTwo.util.ts`). Race joins only when `raceNameable` holds for
  the answerers. Any read or fit failure draws the send unsteered.
- **Draw.** `drawListSample` twice over the list's criteria with cell phones
  forced: 85% with `batchWeights`, the rest unsteered, both leaving out
  `roundTwoExclusions` and the unsteered one the steered picks. Then the
  members are written and `outreachTextSend` enqueued with the purchase
  handler's message group and deduplication id.
- **Dev trigger.** `POST /v1/priorities/round-two/:outreachId/draw` (dev,
  preview and local only, 404 on prod; the office's own sends) draws one now.

No deploy allowlist: it reads the warehouse and enqueues only for sends on
its own database. Design: `docs/features/civic-panel-mrp.md`.
