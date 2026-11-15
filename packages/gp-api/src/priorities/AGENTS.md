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

## A check's first round

Behind `serve-citizen-panels`, the priority chat
(`chats/general/priority-flow/priorityFlow.prompt.ts`) picks how a check
starts, and recommends a warranted check rather than asking whether to
send one. The office's managed civic panel is how it hears from people:
ready, the agent presents the card to ask it; building or paused, it
records the check deferred until it is ready; none, it sets one up in the
thread with the Chief of Staff's civic panel tools and defers the check to
the ready week. The round one text, sized by `size_round_one`, is built
only when the official asks, or when the civic panel is exhausted. No
priority text asks anyone to join a civic panel (only the managed civic
panel's invite waves do), and every one ends with the question, then how
to reply, with the opt-out added under it
(`docs/adr/2026-11-04-civic-panel-is-how-a-priority-hears-from-people.md`).

## Answer coding

`services/priorityAnswerCoding.service.ts`. Replies stay free text; an AI
classifier codes each respondent's answer to the send's question as `yes`,
`no`, `mixed` or `not_an_answer`, one `PriorityAnswer` row each (staff spot
check them). The read status counts them (below). Storing codes is
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
  `priorityAnswerCodingSweep` pg-boss schedule (`6,16,...,56` past the
  hour), which sends one `priorityAnswerCode` job per priority send created
  in the last 30 days, grouped by the send. No deploy allowlist: it calls
  the model only for replies on its own database.

## The read

`PriorityResultsService` decides a priority's good read by counting its
coded answers per group of the district (`countGroups` and
`groupReadStatus`, `util/priorityGroupRead.util.ts`), mapped to the page's
existing `PriorityReadStatus`. Each group is its share of the district
and the people in it with a coded answer
(`docs/adr/2026-11-13-priority-read-counts-groups-no-model.md`). The rule,
the major groups and `needed` are in the webapp's priority AGENTS.md ("A
good read") and `docs/features/civic-panel-rounds.md`. The frame and the
answer cells come from `CensusCompositionSource.readInputs` (the voter
file's district cells reweighted to census sex by age and adults per tract,
`util/censusFrame.util.ts`; a margin the census cannot give keeps the voter
file's, logged; bound in `CensusCompositionModule`; route tests stub it).
`codedAnswers` (`PriorityReadService`) reads `PriorityAnswer` over the same
sends the page counts, one value per person.
`PriorityGroupRead.answersNeeded` is the district's floor, `frameAnswersNeeded` of the
same frame (`contacts/utils/civicPanelAllocation.util.ts`), the one function
`districtAnswersNeeded` sizes round 1 and the panel from, so the read never
calls a priority done before the target the official was given: under it the
read is `notYetRepresentative` and `needed` is at least the floor
(`docs/adr/2026-10-22-priority-read-total-answer-floor.md`). Status:
`tooEarly` while a major group has no answer, `notYetRepresentative` while
one has fewer than `MIN_VOICES_PER_GROUP` (3) or the total is under the
floor, else `representative`; `gettingClose` stays in the contract's enum
but is never produced.
`answerGroups` gives the results page each major group but tracts, its
share of the district against its share of the coded answers, unweighted.
`groupReadStatus` names in `underrepresented` the first two major groups
short of three answers, largest share first (`batchTargets`), and also
returns `unheard`, the named groups with no coded answer
at all (a tract with none makes `unreachedAreas` unheard), and `groupsHeard` of `groupsTotal` (major groups with
at least three coded answers), which the webapp shows instead of an answer
count, and `groupsNext`, the major groups short of three that belong to a
group named in `underrepresented`. `representativeAnswers` of
`representativeNeeded` is what the webapp's seats and bar show, in people:
the floor, and the answers within their major group's share of it on
every dimension (the one furthest behind sets it; small groups and `other`
hold no seats), so a group heard from plenty never fills more than its
share, and a good read fills them all (`representativeOf`). `unreachedAreaFor` takes its tracts from the same read
(`holdingBackTracts`: major tracts short of three answers), so
the area a list is saved to can never disagree with the status.

**No request reads the warehouse for it.** `PriorityReadService` computes
each priority's read in the `priorityReadRefresh` job (`src/jobs/`) and
stores it in `priority_read`, stamped with `inputsKey`: `READ_VERSION` and
the coded answers' count and latest `codedAt`. Every surface (read-status, the
results page, Home cards, the Chief of Staff and priority flow,
`unreachedAreaFor`) reads the stored row through `readsFor`. A row that is
missing or whose `inputsKey` no longer matches is served as it is (null
before the first one: the count alone) and a refresh is queued. Refreshes
are queued when a coding pass writes answers (`codeOutreach`), when a view
finds the row stale, and daily (`priorityReadRefreshDaily`, reads older than
a day) for what moves without a new answer: the warehouse's district data
and the office's district. They are grouped by priority, read the answers
as they are when they run, and skip a read already current and under a day
old. Bump `READ_VERSION` with any change to the frame or how a read is
built. The stored JSON keeps its groups under `result`, as the model's
reads did, so a row stored before counts replaced the model (its groups
also carry `mean`, `low` and `high`) reads correctly until its refresh
rewrites it. A district the warehouse could not read is retried, then
stored as no read, which a view an hour later tries again
(`docs/adr/2026-11-12-priority-read-computed-in-the-background.md`).

A large district reads by areas, not tracts (`util/tractAreas.util.ts`).
Past `MAX_TRACTS_READ_ALONE` (60) tracts, `frameOf` (before the raking)
groups tracts by county (a tract GEOID's first five digits): a county over
1/30 of the district's adults splits into runs of tracts in GEOID order,
each about 1/30 (`37119:2`), one under 1% joins the pooled `other`, and the
rest stay whole (`37119`). The answers, theme cells and adults per tract
map the same way, so the tract dimension, its major groups and
`unreachedAreas` are areas, and `areaOfTracts` turns an area back into its
tracts for the list. A tract cannot reach the 3% major share past about 33
equal ones, so without areas a big district never names a place. A
statewide district (3,003 tracts) is about 25 areas
(`docs/adr/2026-11-13-large-district-reads-use-county-areas.md`).

## Theme ranks and signal

The results response's themes come sorted by `people` (distinct people with
a confirmed note or a reply in the theme), most first, the run's `rank`
breaking ties. Each carries `voices` (`ThemeVoicesSchema` in contracts):
`CensusCompositionSource.themeCells` counts every theme's people in the
read's cells in one warehouse read (`buildThemeCellsSql`, counts only),
and `themeVoices` (`util/priorityGroupRead.util.ts`) checks each group
`answerGroups` shows (major, nameable, no tracts) for
`THEME_VOICES_PER_GROUP` of them: all is `strong`, at least half `fair`,
fewer `thin`, which the page shows as Strong signal, Some signal and Low
signal. No read, no district, or a failed theme read leaves `voices` off.
Only the results route computes it.

## Theme responses and download

`services/priorityThemeComments.service.ts` serves what people said behind
a theme, words only, behind the same office check and `serve-citizen-panels`
404 as the results route:

- `GET :id/results/themes/:themeId/comments` (`PriorityThemeCommentsSchema`):
  the theme's confirmed notes and text replies, oldest first, each as
  `text` and `kind` (`reply` or `note`, a canvasser's summary). The theme
  must come from a pooled run of this org on this priority, else 404.
- `GET :id/results/comments/download[?themeId=]`: a CSV of `Comment` and
  `Theme` only, every comment of the latest completed run once with its
  themes joined, or one theme's. Cells go through `csvCell`
  (`feedbackNotesExport.service.ts`), quoted and formula-guarded.

Neither ever reads a name, number, address, person id or contact record:
the member select is the words and their time, and the response schema
strips anything else. A reply that only opted out is left out, as the polls
download does.

## Round 2 draw

`services/priorityRoundTwoDraw.service.ts`. A priority's round 2 text is
the held half of its first text's purchase (`roundOneOutreachId`, two weeks
after it; see `outreach/AGENTS.md`), paid for in the same checkout and
drawn later: the `priorityRoundTwoDrawDue` pg-boss schedule
(`41 12 * * *` UTC, 7:41 AM Eastern in winter and 8:41 in summer) sends one
`priorityRoundTwoDraw` job for every paid send whose list is still an undrawn sample and whose send
date is on or before `roundTwoDrawCutoff` (three business days out, the last
day a Serve text for that date could be booked).

- **Claim.** After the draw, one transaction stamps the list's `sampledAt`
  where it is null and writes the members, so a list is never claimed with
  no one on it. A failed enqueue deletes the members and clears it again,
  then throws, so the job's retry draws it again; a send that still fails
  dead-letters, which pages.
- **Stranded.** A process that dies between that commit and the enqueue
  leaves a drawn send `pending`. The schedule sends a
  `priorityRoundTwoHandOff` job for any round 2 send whose
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
- **Read.** The priority's read (above), the one the page shows, through
  `PriorityReadService.currentRead`: the stored row, or, when the refresh
  job would compute it again (its `inputsKey` stale, or missing), computed
  and stored in the draw's job first. Its groups and `dimensionsOf` its
  `raceNameable` go to `batchWeights`: `MAX_TARGET_WEIGHT` (4) for a major
  group short of three answers, 1 for every other major group, so the draw
  leans toward the groups the read status names in `underrepresented`. In a district read by areas
  the place factors are areas, so each goes to the GEOID range of tracts
  its area spans (`SampleWeights.tractRanges`, from
  `CensusCompositionSource.areaOfEachTract`): a factor per tract would pass
  the warehouse's 10,000-parameter limit statewide. When it cannot be computed
  then (a warehouse that did not answer), the last stored read leans it
  (`storedRead`). No read at all (no district, nothing stored) draws the
  send unsteered
  (`docs/adr/2026-11-13-round-two-leans-on-the-saved-priority-read.md`).
- **Draw.** `drawListSample` twice over the list's criteria with cell phones
  forced: 85% with `batchWeights`, the rest unsteered, both leaving out
  `roundTwoExclusions` (with opt-outs from the capped
  `findOptedOutPersonIds`, warned when over the cap) and the unsteered one
  the steered picks. Then the `outreachTextSend` job is sent under the purchase
  handler's key and group (`outreachTextSendJob()`).
- **Dev trigger.** `POST /v1/priorities/round-two/:outreachId/draw` (dev,
  preview and local only, 404 on prod; the office's own sends) draws one now.

No deploy allowlist: it reads the warehouse and enqueues only for sends on
its own database. Design: `docs/features/civic-panel-rounds.md`.
