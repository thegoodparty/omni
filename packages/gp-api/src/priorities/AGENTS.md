# src/priorities/

An elected official's priorities: the record, the agent's seven-step status
(`Priority.status`, parsed only through contracts `parsePriorityStatus`), and
the results page's read of who answered the outreach sent on one
(`services/priorityResults.service.ts`).

`nextAction` is shown to the official (the priority rail's "Next" line, the
home Next steps cards), so it is one sentence to them as "you".
`PriorityStatusService.applyUpdate` drops it to null and logs a warning when it
names the official (first or last name) or uses a step id as a name ("so
define can be settled", `listen_problem`). Reads apply the same guard
(`shownNextAction`): every priorities route that returns a priority (list,
get, create, update and `/status`) and the home Next steps cards show a value stored before the write
guard existed as no Next line.

**Report Back Sent** (`EVENTS.Priorities.ReportBackSent`) fires from the Serve
SMS post-purchase step once a report back text is claimed and queued, only
from the claim that won: `answeredCount` (everyone who answered the
priority), `themesShared` (its top themes, at most `MAX_THEMES`) and
`channel` (`text`).

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
- **Where it shows.** On the constituent's record (`contactEngagement/`): each coded text, call or knock in the activity feed names its priority and the answer, and `GET /v1/contact-engagement/:id/priority-answers` lists them all.
- **A text reply's issues too.** On a text send, each pass first hands every
  respondent's joined words to issue capture
  (`ConstituentFeedbackService.recordPriorityTextReplies`, resolved lazily
  through `ModuleRef`), before the coded check, so replies coded earlier get
  theirs on the next pass. That writes a `ConstituentFeedback` row on channel
  `text` with the issue, stance and outcome, so the reply shows in the
  record's "What they told us" beside door and call memos. Idempotent on the
  row's `clientKey` (`priority-text:<outreachId>:<personId>`): unchanged
  words cost no model call. Its failure is logged and never stops the coding,
  which the read depends on. See `constituentFeedback/AGENTS.md`, Text
  replies.
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
from `CensusCompositionSource.mrpInputs` (the voter file's district cells
reweighted to census sex by age and adults per tract, `util/censusFrame.util.ts`;
a margin the census cannot give keeps the voter file's, logged; bound in
`CensusCompositionModule`; route tests stub it). `codedAnswers` reads
`PriorityAnswer` over the same sends the page counts, one value per person.
`MrpRead.answersNeeded` is the district's floor, `frameAnswersNeeded` of the
same frame (`contacts/utils/civicPanelAllocation.util.ts`), the one function
`districtAnswersNeeded` sizes round 1 and the panel from, so the read never
calls a priority done before the target the official was given: under it the
read is `notYetRepresentative` and `needed` is at least the floor
(`docs/adr/2026-10-22-priority-read-total-answer-floor.md`).
`answerGroups` gives the results page each major group but tracts, its
share of the district against its share of the coded answers, unweighted.
`mrpReadStatus` also returns `unheard`, the named groups with no coded answer
at all (a tract with none makes `unreachedAreas` unheard), and `groupsHeard` of `groupsTotal` (major groups with
at least three coded answers), which the webapp shows instead of an answer
count, and `groupsNext`, the major groups short of three that belong to a
group named in `underrepresented`. `representativeAnswers` of
`representativeNeeded` is what the webapp's seats and bar show, in people:
the floor, and the answers within their major group's share of it on
every dimension (the one furthest behind sets it; small groups and `other`
hold no seats), so a group heard from plenty never fills more than its
share, and a good read fills them all (`representativeOf`). `unreachedAreaFor` takes its tracts from the same model
(`holdingBackTracts`: major tracts short of three answers or too unsure), so
the area a list is saved to can never disagree with the status.

## Round 2 draw

`services/priorityRoundTwoDraw.service.ts`. A priority's round 2 text is
the held half of its first text's purchase (`roundOneOutreachId`, two weeks
after it; see `outreach/AGENTS.md`), paid for in the same checkout and
drawn later: the `priorityRoundTwoDraw` cron
(`41 7 * * *` ET, `CronLockService` daily slot, reads before it claims)
draws every paid send whose list is still an undrawn sample and whose send
date is on or before `roundTwoDrawCutoff` (three business days out, the last
day a Serve text for that date could be booked).

- **Claim.** After the draw, one transaction stamps the list's `sampledAt`
  where it is null and writes the members, so a list is never claimed with
  no one on it. A failed enqueue deletes the members and clears it again.
- **Stranded.** A process that dies between that commit and the enqueue
  leaves a drawn send `pending`. The job hands off any round 2 send whose
  list was sampled more than 10 minutes after it was saved (only round 2
  lists are) and more than 30 minutes ago, with members, still `pending`.
- **Check.** The first send puts the check out when it is paid. The draw
  records it again after its enqueue (`recordOutreachSentOrLog`), which
  leaves a side already out as it is. `recordOutreachSent` skips a send
  whose list is still undrawn, so a follow-up never puts a check out
  before it is drawn.
- **Shown.** `readStatuses` carries the next paid, unsent follow-up per
  priority as `followUp` (`scheduledLocalDate`, `texts`), `followUpSent` once
  one has gone out, and `checkOut` once anything has gone to residents on
  any channel, for the priority page and the agent's `<priority>` block. The
  agent offers no text while a follow-up is scheduled or sent
  (`checkFollowUpPart`): a short read is closed with calls and doors.
- **Undrawn list.** It stays off the lists index (`findByOrganizationSlug`
  and its siblings leave out `UNDRAWN_SAMPLE_WHERE`) and
  `assertNotLocked` 409s an edit or delete of it, even by id.
- **Nobody left.** A draw that finds no one cancels the send
  (`canceledBy: round_two_drew_nobody`), logged at error for a hand refund.
- **Fit.** The priority's coded answers (`yes` 1, `no` 0, `mixed` 0.5,
  `not_an_answer` out), placed by `CensusCompositionSource.weightingInputs`
  once per code, against a frame of the census shares
  (`util/roundTwo.util.ts`). Race joins only when `raceNameable` holds for
  the answerers. Any read or fit failure draws the send unsteered.
- **Draw.** `drawListSample` twice over the list's criteria with cell phones
  forced: 85% with `batchWeights`, the rest unsteered, both leaving out
  `roundTwoExclusions` (with opt-outs from the capped
  `findOptedOutPersonIds`, warned when over the cap) and the unsteered one
  the steered picks. Then `outreachTextSend` is enqueued with the purchase
  handler's message group and deduplication id.
- **Dev trigger.** `POST /v1/priorities/round-two/:outreachId/draw` (dev,
  preview and local only, 404 on prod; the office's own sends) draws one now.

No deploy allowlist: it reads the warehouse and enqueues only for sends on
its own database. Design: `docs/features/civic-panel-mrp.md`.
