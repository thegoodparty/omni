# constituentFeedback

Issue capture, on Win and Serve. A canvasser or caller records a short spoken
summary of one conversation; the request extracts the issues the person
raised (up to five), each with a stance and an outcome, and hands them back
for the person who was just there to confirm, correct or remove. The module keeps its name; the user
never sees it.

An effort's confirmed memos are then synthesized into ranked themes, each
proposing a tag for the org's list, and read back as the effort's report.
A Serve text send is an effort too: the constituents' replies are its
memos, synthesized the same way once the results upload lands (decided
2026-10-12; `docs/features/serve-sms.md`).

With no signal, the phone records the memo instead and sends it later; the
server transcribes it, extracts, and confirms it automatically (see Offline
memos).

A Serve resident's text reply to a priority's check is read for issues the
same way, so it shows on their record beside the door and call memos (see
Text replies).

## Key files

| File                                                | Purpose                                              |
| --------------------------------------------------- | ---------------------------------------------------- |
| `constituentFeedback.controller.ts`                 | Routes under `/v1/constituent-feedback`              |
| `services/constituentFeedback.service.ts`           | Resolve, upsert, confirm, read                       |
| `services/constituentFeedbackExtraction.service.ts` | The issues, via `LlmService.jsonCompletion`          |
| `services/feedbackSynthesis.service.ts`             | `requestRun`: floor, cooldown, run row, engine start |
| `services/synthesisEngine.ts`                       | The engine seam and its `SYNTHESIS_ENGINE` token     |
| `services/pipelineSynthesisEngine.ts`               | CSV to S3, trigger the polls pipeline                |
| `services/mockSynthesisEngine.ts`                   | In-process stand-in for laptops and dev              |
| `services/feedbackSynthesisIngest.service.ts`       | The one write path for a run's results               |
| `services/feedbackThemeIssueMatch.service.ts`       | After a run: each issue to one of its note's themes  |
| `services/feedbackReport.service.ts`                | The effort report and theme page, counted at read    |
| `services/feedbackNotesExport.service.ts`           | Every note on an effort as a CSV download            |
| `services/issueTag.service.ts`                      | Tag list and curation: accept, rename, merge, retire |
| `services/issueTagSeed.service.ts`                  | Win: accepted tags from declared positions           |
| `services/feedbackSeed.service.ts`                  | Dev-only fake memos on an effort                     |
| `services/synthesisStaleRunSweep.service.ts`        | Fails runs that never reported back                  |
| `services/pendingTranscription.service.ts`          | Offline memos, and the abandoned-confirm sweep       |
| `util/issueTagName.util.ts`                         | `normalizedName`, always derived server-side         |
| `util/devOnlyRoute.util.ts`                         | The deploy gate on the seed and the mock audio sink  |
| `schemas/`                                          | Query DTOs for the two list routes                   |

Request/response shapes are in `@goodparty_org/contracts`
(`src/constituentFeedback/`), not here — the webapp is the consumer.

## Prisma model

`ConstituentFeedback` — via `this.model` / `this.client.constituentFeedback`.
Its issues are `ConstituentFeedbackIssue` rows
(`this.client.constituentFeedbackIssue`), one per issue in `position` order
from 0, unique on `(feedbackId, position)`.
A capture's extraction replaces a memo's issues whole (`replaceIssues`:
delete, then insert, in one transaction), keeping the first five with a name
and dropping the rest. Confirm keeps the rows it names by id and updates them
in place.
Enums: `ConstituentFeedbackChannel`, `ConstituentFeedbackStance`,
`ConstituentFeedbackCaptureMethod`, `ConstituentFeedbackExtractionStatus`,
`ConstituentFeedbackConfirmation`.

## Tables

The effort is the `Outreach` envelope: one key for a turf, a phone list, or
a Serve text send (`outreachType: text`, `campaignId: null`; a Win text's
replies come back as timestamps, never words, so it is not one).

- `ConstituentFeedback.outreachId`: the memo's effort, resolved at capture.
  A knock memo takes the knock row's own `outreachId` and falls back to the
  stop target's turf only when that is null; the question comes from the same
  envelope. A knock with neither 404s; a call on a list with no envelope saves
  with null (a Win list made without a Campaign row has no envelope).
- `ContactInteractionDoorKnock.outreachId`: the knock's effort, written by
  the door-knocking write path. Null on knocks recorded before it existed, and
  on manual CRM knock logs, which belong to no effort.
- `ConstituentFeedbackUnreviewedIssue` (relation `unreviewedProposal`): what
  the model proposed for a memo confirmed without review, one row per issue
  in `position` order, raw model text. Measurement only (see Confirmation).
- `IssueTag`: the org's tag list, unique on
  `(organizationSlug, normalizedName)`. `IssueTagStatus`: proposed, accepted,
  retired.
- `ConstituentFeedbackTag`: a tag on a memo. `runId` null means a human
  applied it.
- `FeedbackSynthesisRun`: one synthesis over an effort, a priority, or the
  whole org. `activeKey` is unique while running, so one run is in flight per
  scope. A `priority` run sets `priorityId` and leaves `outreachId` null.
  Superseded runs are kept as history.
- `FeedbackTheme`: one ranked grouping a run produced, linked to a tag.
- `FeedbackThemeMember`: a memo in a theme, or on a text send a reply
  (`PollIndividualMessage`). Exactly one of `feedbackId` / `textReplyId`
  is set (DB CHECK `feedback_theme_member_source_check`), under a surrogate
  id and a unique pair per source. Counts are computed from these rows at
  read time, never stored.
- `FeedbackThemeIssue`: one issue a member memo raised, assigned to one of
  that memo's themes, keyed on the `(themeId, issueId)` pair and deleted
  with either side. `FeedbackSynthesisRun.issuesMatchedAt` is set when the
  run's matching completed (see The ingest).

A run never overwrites a human's tag row. It skips any
`ConstituentFeedbackTag` pair that already exists, and superseding a run
deletes only the rows carrying its `runId`.

## HTTP routes

All under `@Controller('constituent-feedback')`, all `@UseOrganization()`.

- `POST /`: record a memo. With a `transcript`, extracts in the request and
  returns the proposed issues (`extraction: { issues }`, null when extraction
  failed, an empty list when the note named none). With an `audioKey` (the offline path), saves
  it pending and starts a transcription job. `@AllowVolunteer()`.
- `PATCH /:id/confirm`: `{ issues, skipped? }`, at most five issues, each
  `issueLabel`, `stance`, `desiredOutcome` and an optional `fromIssueId`.
  The list REPLACES the memo's issues, positions reassigned in list order:
  removing one is leaving it out, and an empty list confirms a memo that
  named none. A `fromIssueId` keeps that row; one that is not this memo's,
  or is named twice, is a 422. Sets `confirmedAt` and `confirmation:
  reviewed`. `skipped: true` is the confirm step's Skip: it needs an empty
  list (400 otherwise) and confirms with `confirmation: skipped` (see
  Confirmation); on a memo already confirmed it changes nothing and returns
  the record, since a dismiss can land after a "Looks right".
  `@AllowVolunteer()`.
- `POST audio-upload-url`: `{ clientKey, contentType }` to `{ audioKey,
uploadUrl, fields, expiresAt }`, a presigned POST. `@AllowVolunteer()`.
- `POST audio-upload/:clientKey`: the mock-mode upload sink (multipart,
  same 5 MB cap); 404 otherwise.
  `@AllowVolunteer()`.
- `GET /?personId=`: that person's memos, newest first, with their accepted
  tags. Default posture: owner or campaign manager (a volunteer gets 403),
  since it is the CRM's record of a person.
- `GET efforts/:outreachId/report`: denominators, the latest run, themes.
- `GET efforts/:outreachId/export`: every note on the effort as a CSV
  download, confirmed and pending, not the report's 200-note display cap.
  Same access posture as the report. Generated from the database rows, never
  from the pipeline's S3 input file; `services/feedbackNotesExport.service.ts`.
- `POST efforts/:outreachId/synthesize`: start a run. 422
  `{ confirmed, required }` under the floor, 429 in the cooldown, 409 while
  one is in flight.
- `GET themes/:id`: one theme with its confirmed members.
- `GET tags?status=` and `PATCH tags/:id`: the tag list and its curation.
  Each tag carries `proposedByRunId`, the run that last proposed it.
- `POST seed`: dev-only fake memos; 404s on prod.

The report, synthesis, theme and tag routes are default posture: what
people said across an effort, and the org's vocabulary for it, are the
manager's.

The writes admit volunteers because the person who had the conversation is
who records and confirms it, the posture the knock and call routes already
carry, and under the same rule: a volunteer acts only on an effort they hold
an `OutreachAssignment` on (`assertVolunteerAssignedToOutreach`, the knock
routes' predicate). Capture checks the resolved `outreachId` before it spends
an extraction; confirm checks the row's, and lets a volunteer confirm (or
skip) only a memo they recorded. A volunteer gets the same 404 the
knock or call route would give ("Stop target not found" / "Phone banking list
not found"), including for a memo with no effort, which nothing can be
assigned to. Owners and campaign managers are unaffected.

Every route is flag-gated and 404s when the flag is off, so a surface a user
has not been rolled out to does not advertise itself. One flag,
`issue-capture` (`ISSUE_CAPTURE_FLAG`), gates Win and Serve alike. Unlike
`outreachServeSms.controller.ts`, which gates only its writes, there is no
inert read here — the reads are the feature. `@UseOrganization()` and its role
guard are the access check; the flag gates rollout, not access.

That 404 carries `errorCode: ISSUE_CAPTURE_OFF` (`ISSUE_CAPTURE_OFF_ERROR_CODE`
in contracts), and no other 404 here does. It is how a phone replaying memos
it held with no signal tells "not now" from a refusal: it keeps a memo the
flag turned away and drops one refused for a reason of its own. The flag
checks fail closed, so an Amplitude that does not answer reads as off and
gets the same code; neither a kill switch nor an outage deletes what a
canvasser recorded.

**The flag is the org's.** Every route asks it of the org's owner
(`organization.ownerId`), whoever is asking, and so does the variants
endpoint the webapp's knock and call forms read (`ORGANIZATION_FLAGS`,
`src/features/README.md`). On Win, volunteers do most of the door knocking,
and Amplitude buckets by user id: asked per person, a percentage rollout
would leave a flagged campaign's volunteers mostly without capture and give
it to some volunteers of an unflagged one. A volunteer of an org whose owner
is off gets the same `ISSUE_CAPTURE_OFF` 404 as anyone else, so their phone
keeps what it holds.

## Confirmation

`confirmedAt` set means the memo is confirmed and counts: its words go to
synthesis and it is a confirmed memo on the report. `confirmation` says how,
and is null while `confirmedAt` is:

- `reviewed`: the person who was there accepted or corrected the issues
  (`PATCH /:id/confirm`). The only kind that carries issues.
- `skipped`: they passed on the check (`skipped: true`).
- `automatic`: nobody could check it. An offline memo once its transcript
  is in (see Offline memos), or a live memo whose confirm step was abandoned
  (the sweep below).

A skip and an automatic confirmation leave the memo NO issues. What the
model proposed moves to `unreviewedProposal`, in position order and in the
model's own words (`setAsideProposal` in `constituentFeedback.service.ts`,
one transaction with the confirm): the `proposed*` values of the memo's
issue rows, or for an offline memo the extraction itself. None when nothing
was proposed or extraction failed. It exists only to
measure extraction; nothing reads it but tests. It is kept apart from
`issues` on purpose: the report (`summarize`, the memo list), the CSV export,
the person record (`GET /?personId=`) and the assistants'
`capturedNotes` (`priorityFlowOutreach.service.ts`) all read a memo's
issues, and an empty list there means none of them can count or show a
guess nobody checked.

## Text replies

`recordPriorityTextReplies`, called by the priority answer coding pass
(`priorities/AGENTS.md`) for every respondent on a priority's text send: the
person's `CONSTITUENT` replies, opt-outs left out, joined oldest first. One
row per person per send on channel `text`, keyed by `clientKey`
`priority-text:<outreachId>:<personId>` (`textReplyClientKey`), so a second
read lands on the first row and unchanged words (a row already `extracted`
with the same transcript) cost no model call. A `failed` extraction is read
again on the next pass.

- **Extraction is the memo's**, `ConstituentFeedbackExtractionService` with
  `voice: 'own_reply'`: the same prompt with one paragraph saying the words
  are the person's own, and "They were asked" with the check's question.
- **`occurredAt`** is the person's last reply; **`actorUserId`** is the org's
  owner, since a reply has no author on the office's side (the record shows
  no name for it); **`captureMethod`** is `typed`.
- **`outreachId` is null on purpose.** The send's report already counts its
  replies as replies (`textRepliesWhere`), and every effort read (the report,
  the export, synthesis, the assistants' notes) keys on that column, so
  a set one would count the same words twice.
- **Never confirmed.** Its issues are a model's reading nobody checked, so
  `confirmedAt` stays null and nothing that counts confirmed memos sees it.
  The abandoned-confirm sweep passes `text` rows by: there is no confirm step
  to abandon, and confirming would strip the issues it exists to show.
- **Not a capture route.** `POST /` takes `door_knock` and `phone_bank` only;
  `text` is written by the coding pass alone.

**The abandoned-confirm sweep.** A live memo that has a transcript, no
`confirmedAt`, and no write for `ABANDONED_CONFIRM_AFTER_HOURS` (2) had its
confirm step abandoned: the app closed on the card. The
`feedbackPendingTranscription` pass confirms these too, 25 a pass, the way a
skip does but as `automatic`, each conditional on `confirmedAt` still null
and `updatedAt` unchanged since the pass read it, so a confirm that lands
first keeps what its confirmer gave. Its read, oldest `updatedAt` first, runs
on the `(confirmedAt, updatedAt)` index, so a pass never scans the table.

## Synthesis

`requestRun` loads the effort's confirmed memos that have a transcript (one
confirmed by hand after a failed recording has none, and would be an empty
CSV row), refuses under `MIN_CONFIRMED_FOR_SYNTHESIS` (5, provisional),
inserts a `running` run whose `confirmed` is that count, and hands the memos
to the engine. On a text send the memos are the send's `CONSTITUENT` reply
rows minus opt-outs and empty bodies (`textRepliesWhere` in
`feedbackReport.service.ts`, the one predicate the floor, the run and the
denominators share), each keyed by the reply row's id so the ingest can
find it again; a reply is the constituent's own words and needs no
confirming. Two ways in: the report's button (`trigger: 'button'`), which
is also refused inside `SYNTHESIS_COOLDOWN_MS` (10 minutes since the last
completed run), and the effort completing (a turf's Done in
`doorKnockingTurf.service.ts`, a list's last call in
`phoneBankingCall.service.ts`, a text send's committed results upload in
`outreach/services/outreachResultsAdmin.service.ts`), which calls
`requestRunOnEffortCompleted`
fire-and-forget, skips the cooldown, and swallows the floor and the run in
flight. That path has no request to flag-gate, so it checks the floor and
then the flag for the org's owner itself; turning the flag off
stops automatic runs too. The first run of a Win org seeds accepted tags
from its `CampaignPosition`s first.

- **The race guard is the index.** `activeKey` is
  `<org>:<outreachId>` while a run is in flight and unique, so the button and
  the trigger racing each other cannot both insert. The P2002 maps to 409.
  There is no read-then-insert check, on purpose.
- **Two engines, one ingest.** `FEEDBACK_SYNTHESIS_ENGINE=mock|pipeline`
  (unset is `pipeline`) picks the engine at boot; any other value, or a
  `FEEDBACK_SYNTHESIS_MOCK_GROUPING` other than `llm|canned`, fails boot. The
  pipeline engine writes `feedback-input/{runId}.csv` to
  `SERVE_ANALYSIS_BUCKET_NAME` and that is the whole hand-off: the bucket's
  notification on `feedback-input/` starts the run (not `input/`, which starts
  a poll run), with the filename as the run id. gp-api holds no key or
  hostname for the pipeline. The pipeline answers later with
  `feedbackSynthesisComplete` on the shared queue; S3 can notify twice, and
  the ingest ignores a completion for a run no longer `running`. The mock
  waits five seconds and builds the same event in-process, with one LLM call
  or, under `FEEDBACK_SYNTHESIS_MOCK_GROUPING=canned`, three fixed themes and
  no call. Both end in `FeedbackSynthesisIngestService.handle`, so a laptop
  run exercises the real write path. `.env.test` pins mock and canned.
- **An engine that cannot hand off fails the run itself**, freeing the
  `activeKey`. A run whose event never arrives is failed (`error: timeout`)
  after 30 minutes by the stale-run sweep, every ten minutes under
  `CronLockService`.

### Priority runs

`requestPriorityRun` pools every Serve send linked to one priority
(`Outreach.priorityId`, `campaignId` null, gone out) into one run: each
send's memos or replies, loaded exactly as its own effort run would load
them, against the same floor. It has no route and no cooldown of its own.
`requestRunOnEffortCompleted` starts it alongside the effort's own run
whenever a send on a priority finishes, and the report's Summarize button
starts it after the send's own run, so the priority's themes never trail a
send's. Either way it runs whatever that send's own floor is, so a
door walk after a text re-pools the same priority and the new run supersedes
the last. The activeKey is `<org>:priority:<priorityId>`. A send that finishes
while a pooled run is in flight marks that run `repoolOwed`, and the
stale-run sweep starts a fresh pooled run once it is done, so that send's
answers are never left out. The ingest scopes a
priority run's members to that priority's sends, and writes its themes with
no tag: the tag list and a memo's tags come from the send's own run, and a
second vocabulary for the same conversation would only compete with it. The
themes are read by gp-api `PriorityResultsService` and the priority agent's
`read_outreach_feedback`.

## The ingest

One transaction, claimed first with a conditional update on
`status = running`, so a redelivered event writes nothing twice.

- A theme's members are the union of the S3 rows at `responsesLocation`
  matching its title (the pipeline writes them; the mock sends null), its
  quotes, and its `memberIds`. Each id is looked up in both tables, memos
  and `CONSTITUENT` replies, and written as the member kind it was found
  as; ids outside the run's effort or org are dropped and counted in the
  log. If no theme keeps a member, the run fails
  (`error: no_members_in_scope`) rather than superseding a good one. A
  reply member gets no `ConstituentFeedbackTag` row: a tag lands on a
  memo's record, and a reply has none.
- One tag per theme, by `normalizedName`: merged away follows
  `mergedIntoId` to its target (one hop; merges re-point earlier ones) and
  is then handled as that target, which may since have been retired;
  accepted is linked; retired is revived to `proposed` with `updatedAt` set
  back to `createdAt`; proposed is relinked to this run; none is created
  `proposed`, `source: synthesis`. Relinking carries `updatedAt` over, and
  reviving resets it, so neither counts as a human touching the tag.
- **Old runs are kept.** The previous completed run for the scope becomes
  `superseded`; its themes and members stay as history. Its tag rows and its
  untouched `synthesis` proposals (`updatedAt = createdAt`) are deleted
  explicitly, because a status change cascades nothing; a seeded or typed
  tag it revived is a person's, and stays. That happens before this run's
  tag rows are written, or a pair both runs applied would be lost.
- `ConstituentFeedbackTag` rows are written with `skipDuplicates`, which is
  what keeps a human's row on a pair the run also applies.
- After commit it fires `Issue Capture - Synthesis Completed` through
  `AnalyticsService`, attributed to the requester or, for a triggered run,
  the org's owner: `scope`, `outreachId`, `themeCount`, `confirmedCount`,
  `product`. Never a transcript, label or outcome.
- **Then it matches issues to themes**, after the commit and not awaited
  (the queue consumer awaits `handle`, and a model call there would hold up
  the messages behind it). Membership is per memo, because the pipeline
  clusters memo text only, so a memo about schools and safety sits in both
  themes with both issues. `FeedbackThemeIssueMatchService.matchRun` makes
  one `LlmService.jsonCompletion` call for the run (no retries, a two-minute
  timeout): the run's themes (title, summary) and, for every confirmed
  member memo, its issues (label and outcome, clamped) and the themes that
  memo is in, under short refs rather than row ids. The model assigns each
  issue to at most one of ITS memo's themes, or none. The answer is checked:
  an unknown ref, a theme the memo is not in, or a second theme for one
  issue is dropped. The rows and `issuesMatchedAt` are written together.
  A failure (model error, timeout, invalid output) logs a warn with the
  `runId` and leaves the run unmarked, so the report falls back; it never
  fails or rolls back the run. A run with no issue to send (a text send's
  replies, memos that named none) is marked with no call. Only effort runs
  are matched: a priority run's themes are read for their people, never
  their stances (`PriorityResultsService`, `read_outreach_feedback`).

## The report

Counts are computed when the report is read, from member rows whose memo is
confirmed now, never stored. A memo re-recorded after a run loses
`confirmedAt` and stops counting on the next read, with no new run. The
denominators: conversations are distinct people who answered (knocks on the
effort's `outreachId`, calls on its list), plus memos, confirmed, and
pending from `ConstituentFeedback.outreachId`. `run` is the latest
non-superseded run; themes come from the latest completed one, so a run in
flight or a failed one leaves the previous themes up. `memos` lists the
effort's memos, confirmed and pending, newest first, capped at
`FEEDBACK_REPORT_MEMO_LIMIT` (200): the page shows them when there are no
themes to show, under the floor and while a run is in flight. Each carries
its `extractionStatus`; with no transcript, `pending` is a recording still
being transcribed and `failed` one no job could read.

A theme's `conversationCount` is distinct confirmed member memos plus reply
members. When its run's matching completed, `stanceCounts` and
`desiredOutcomes` come only from the issues assigned to this theme
(`FeedbackThemeIssue`), among its confirmed member memos, so a memo about
schools and safety adds its schools stance to one theme and its safety
stance to the other. A theme with no assigned issue has `stanceCounts: null`.
When matching did not complete (in flight, failed, or a run from before it
existed), they come from every issue raised in the theme's memos, and a memo
that raised two issues contributes two. Either way the theme page lists
every member memo in full with all its issues. An issue edited after the
run keeps its assignment (confirm updates rows in place by id); an issue
added after the run is in no theme until the next run, and a re-recorded
memo's issues are replaced, which deletes their assignments. An issue with
no stance counts as unclear; a reply names none, so a theme of replies has
`stanceCounts: null`, which the page reads as nothing to show rather than
four zeros. `channel` is
the effort's own (a turf's envelope is `door_knock`, a list's `phone_bank`,
a text send's `text`, memo or no memo), and `floor` is
`MIN_CONFIRMED_FOR_SYNTHESIS`, sent so the
page's "Themes appear after N" line cannot drift from the 422. The constant
lives in `feedbackReport.service.ts` because the synthesis service imports
that file, not the other way round.

On a text send the denominators are the replies with words and the distinct
people who sent them, `confirmed` equals `memos` and `pending` is 0, and
`memos` lists those replies as the constituent's own words (`channel: text`,
no issues, no actor, `confirmedAt` the moment it arrived). A theme page's
reply member carries `textReplyId` and a null `feedbackId`. Nothing here
or on the export (`feedbackNotesExport.service.ts`, which reads memos only)
ever returns the number a reply came from.

## Tags

`normalizedName` (lowercase, trimmed, spaces collapsed) is always derived in
`util/issueTagName.util.ts`, never taken from a client. Rename onto another
tag's name is a 409 from the unique index. Merge needs an accepted target
(else 422), moves the memo rows (skipping pairs the target already has) and
theme links, re-points earlier merges at the new target, and retires the
source with `mergedIntoId`.

## The seed route

`POST seed { outreachId, count }` writes answered knocks or calls and
confirmed memos from a 40-memo fixture (`services/feedbackSeedMemos.ts`,
five issues, one to three per memo) on an effort that already has stop targets or list entries. A
list takes one memo per person who has none. Gated like the community
issues seed (`util/devOnlyRoute.util.ts`): `OTEL_SERVICE_ENVIRONMENT`
unset, `local`, `test`, `preview` or `dev`; anything else 404s.

## Offline memos

Dead zones are where door knocking happens. With no signal (or a dictation
socket that does not open in three seconds) the phone records the memo with
`MediaRecorder` and holds it in IndexedDB with its knock or call; once
signal returns it sends the knock or call, then the memo. The webapp side is
`app/dashboard/shared/dictation/useOfflineMemo.ts`.

1. `POST audio-upload-url` builds the key
   `constituent-feedback/{organizationSlug}/{clientKey}.webm` from the memo's
   own replay key, so a re-sent upload overwrites the same object and no key
   names another org's audio, and returns a 15-minute presigned POST on
   `SPEECH_BUCKET` whose policy pins the recording's `audio/*` type and
   caps it at `CONSTITUENT_FEEDBACK_AUDIO_MAX_BYTES` (5 MB, about two
   minutes), so S3 refuses a runaway recording at upload time. The prod
   bucket's CORS rule allows that POST from the prod app's origins
   (`deploy/components/meeting-pipeline-bucket.ts`). `.webm` even for
   Safari's mp4: Transcribe reads the container, not the name.
2. `POST /` with that `audioKey` and `captureMethod: dictation_offline`
   resolves the knock or call and runs the volunteer check exactly as the
   transcript path does, refuses (400) a key that is not the one built from
   this `clientKey`, then upserts the row (same interaction-first rule as
   below) with `transcript: null`, `extractionStatus: pending` and
   `confirmedAt: null`, and starts a Transcribe job, recording
   `transcriptionJobName`. A job that fails to start leaves the name null
   for the cron.
3. `PendingTranscriptionService` (`feedbackPendingTranscription`, every
   minute, `CronLockService` minute slot) reads rows that are pending, have
   an `audioKey` and no transcript, and are not confirmed, oldest touch
   first, 25 a pass, alongside the abandoned-confirm sweep (see
   Confirmation). It reads before it claims, so an idle minute writes no
   `cron_run` row. Per row: start the job if there is none, else poll it.
   On text it writes the transcript, runs extraction exactly as a live
   capture does, and confirms the memo `automatic` in the same conditional
   write (`completeTranscription`): no issue rows, the extraction's issues
   go to `unreviewedProposal`. A failed extraction confirms too; synthesis
   needs only the words.
4. Retries. `transcriptionAttempts` counts jobs started or tried, a failed
   start included. A failed job, or one still running an hour after the
   row's last write (applied after the poll, so a job that finished while
   the cron was not running is read rather than failed), starts a new job
   (`restartTranscription`) while fewer than `MAX_TRANSCRIPTION_ATTEMPTS`
   (3) have run; after that the memo is `failed`. A start that failed is
   tried again only `START_RETRY_AFTER_MINUTES` (10) after the last
   attempt, so the attempts outlast a Transcribe or AWS outage of a few
   minutes rather than all failing inside it. An empty transcript is
   silence, which another job would hear the same way, so it fails at once.
   A `failed` memo with no transcript is unreadable: it stays unconfirmed,
   and the report lists it with `extractionStatus: failed`. Every write is
   scoped by the job name, so a memo re-recorded meanwhile is left to its
   own job, and to `confirmedAt` null, so one confirmed meanwhile keeps the
   issues its confirmer gave. No deploy allowlist: it calls Transcribe only
   for memos recorded on its own database.

**Mock mode.** `SPEECH_TRANSCRIBE_FILE_MODE=mock` (see `src/speech/AGENTS.md`
for the transcription half). The upload URL then points at
`{APP_ROOT}/api/v1/constituent-feedback/audio-upload/{clientKey}`: the
webapp's `/api` proxy, which adds the session, to `POST
audio-upload/:clientKey` here: a multipart form read through
`FilesInterceptor` with the same 5 MB cap, kept nowhere. It is keyed by the
`clientKey` because the whole audio key runs past Fastify's 100-character
route parameter limit. The sink 404s outside mock mode or off a dev-only
deploy. `.env.test` sets `mock`.

## Priority answer coding

A memo captured with words, or confirmed, on an effort linked to a priority
has its answer to the priority's question coded, fire-and-forget after the
memo is saved (`codePriorityAnswers`, resolved lazily). The memo stands
whatever the coding does. See `src/priorities/AGENTS.md`, "Answer coding".

## The extraction prompt names no product

The same issues land on a voter's record and a constituent's, and the
copy around them is mode-keyed by the UI. So the prompt says "the person they
spoke with", never voter or constituent: a product noun there steers the
model into writing one product's word into the other's record.
`constituentFeedbackExtraction.test.ts` asserts neither word appears. The
mock engine's grouping prompt and the theme issue matching prompt follow the
same rule; `feedbackSynthesis.routes.test.ts` asserts it for the latter.

## Why extraction is synchronous

It would be cheaper on a queue. It is in the request because the confirmation
step needs the person who heard the conversation, and that person is only
present for the few seconds after they stop speaking. The one exception is
a memo recorded with no signal: nobody is at the door when it is
transcribed, so the cron extracts it and confirms it with no issues, rather
than asking anyone to correct it later from a transcript. Corrections made by
someone reading a transcript who was not there are a different and much
weaker claim about what a person said.

A failed extraction never fails the request. `extract()` returns null, the row
persists with its transcript and `extractionStatus: failed`, and the surface
shows an empty issue to fill in by hand. The memo is the record worth
keeping.

## proposed\_\* vs the confirmed columns

On each `ConstituentFeedbackIssue`, `issueLabel` / `stance` /
`desiredOutcome` hold what a human confirmed (until then, the model's answer
clamped to fit). `proposedIssueLabel` / `proposedStance` /
`proposedDesiredOutcome` hold what the model said first. The diff between
them is the correction rate, and it is the labeled corpus the synthesis phase
gets evaluated against — it cannot be reconstructed later, which is why it is
written here.

Confirm keeps each issue it names in `fromIssueId`: the same row, its
`proposed*` untouched, its confirmed values and position updated in place.
An id and not a position, because confirming renumbers positions, and a
confirm tapped again after its response was lost has to land on the same
rows; repeating one changes nothing. An issue with no `fromIssueId` (written
by hand) is a new row with null proposals. A proposed issue the canvasser
removed is deleted with its proposal.

`proposedStance` is text, not the enum. The model is prompted for one of four
values but not bound to them, and `toStance()` drops an off-vocabulary answer
to a null stance while the raw string survives for whoever asks why.

## Re-recording

A memo can be recorded more than once for the same conversation: a dead-zone
retry, or a deliberate correction, or an edit of a call already logged. Three
rules hold that together.

- **The row is resolved by its INTERACTION, not by `clientKey`.** One memo per
  interaction is the real invariant, and both unique indexes say so. A client
  cannot be relied on to re-send the same replay key — the phone panel keys its
  form on `personId`, so switching tabs mints a fresh uuid — and keying the
  upsert on it alone takes the create branch and collides on
  `phoneBankingInteractionId` rather than updating what is already there.
  `clientKey` is still the fallback, which is what covers a retry whose first
  attempt never landed.
- **A re-record clears `confirmedAt`.** The update branch replaces the issues
  with a fresh model proposal, so any confirmation the old one earned is void.
  Leaving it set hands reporting a model guess wearing a human's signature,
  which is the one thing the column exists to prevent. `confirmation` and
  `unreviewedProposal` go with it.
- **An overlong proposal is truncated, not rejected.** The response schema caps
  each issue's `issueLabel` at 120 and `desiredOutcome` at 1000 and the
  interceptor enforces that on the way out, so an unclamped string would save
  the row and then 500 the request that saved it — the surface would show a capture failure for a
  memo safely on disk. The untruncated text survives in `proposed*` and in the
  transcript.

`tests/constituentFeedback.routes.test.ts` covers all three.

## The question shapes the script, not just the memo

`communityInputQuestion` is captured in both setup flows and then does two
jobs. It is denormalized onto each feedback row as `effortQuestion`, so an
extraction stays readable against the prompt it ran with. And it is sent to
the draft endpoints (`POST /v1/outreach/serve/door-knocking/draft`,
`POST /v1/outreach/serve/phone-banking/draft` and their Win twins) so the
generated card or script asks THAT question rather than a generic one — without it, a compost
pilot effort shipped an ask reading "what should the council be focusing
on", which is the opposite of the point.

- **Optional, on both products.** `community_input` is Win's "Hear from
  voters" and Serve's community input, and the Win draft endpoints
  (`POST /v1/outreach/door-knocking/draft`, `POST /v1/outreach/phone-banking/draft`)
  take the field too. A request without it is byte-identical to before: the
  Win tests diff the prompt with and without the field and assert the question
  block is the only difference. The phone block names the person in the
  rail's own word (`personNoun`), so a Win prompt never says constituent.
- **Sent, not read server-side.** Neither the turf nor the list exists at
  draft time — both are created at the end of the flow.
- **Fenced in the prompt**, like every other piece of user text, so a typed
  question reads as quoted material rather than as instructions.
- **Precedence is stated explicitly.** The door's listening purpose tells the
  model the ask IS the general question, and the phone's purpose bans a
  yes/no question while a real one is often partly yes/no. Both prompts now
  say the effort's question takes precedence, and the phone's adds that the
  caller should invite elaboration — otherwise the two instructions simply
  conflict and which one wins is luck.
- **The phone defers its draft; the door already did.** Door knocking drafts
  on arrival at the talking-points step, which is after the question. Phone
  banking drafted on the purpose pick, which is before it, so for this one
  purpose the draft moved to the question step's Continue — guarded on
  `scriptManuallyEdited` so a walkback cannot discard the official's wording.

## Gotchas

- **Neither capture surface knows its interaction row's id.** The knock
  contract returns `{personId, knockStatus}` and the call contract returns
  interactions without ids. So the capture payload references a knock by the
  `clientKey` it already minted (persisted as `sourceId`) and a call by
  `(entryId, personId)`. Both are resolved server-side.
- **`effortQuestion` is denormalized onto the row.** The effort's question can
  be edited after the fact, and an extraction has to stay readable against the
  prompt it actually ran with.
- **`audioKey` is set only on offline memos.** Live dictation streams to
  Transcribe over a socket and stores no audio; a live re-record of an
  offline memo clears both `audioKey` and `transcriptionJobName`.

## Running locally

Three switches in `packages/gp-api/.env` run the whole feature on a laptop
with no AWS and no pipeline (`.env.example` sets the first and third):

| Variable                           | Value             | Effect                                                                         |
| ---------------------------------- | ----------------- | ------------------------------------------------------------------------------ |
| `FEEDBACK_SYNTHESIS_ENGINE`        | `mock`            | A run completes in-process after five seconds, through the real ingest         |
| `FEEDBACK_SYNTHESIS_MOCK_GROUPING` | `llm` or `canned` | One LLM call groups the memos, or three fixed themes and no call               |
| `SPEECH_TRANSCRIBE_FILE_MODE`      | `mock`            | Offline recordings go to the dev-only sink and come back as a fixture sentence |

Extraction is never mocked: every memo with words calls the model through
`LlmService`. Mock mode covers recordings only; live dictation is
Transcribe streaming and still needs AWS credentials, so type the memo to
see the confirm card without them.

Flags: with a real `AMPLITUDE_PROJECT_API_KEY`, gp-api asks Amplitude for
`issue-capture`, and a flag Amplitude does not define reads off, so every
route 404s. With the `.env.example` placeholder (`some_key`), gp-api's
per-route flag guard reads every flag as on, but its variants endpoint
returns no variants, so the webapp sees every flag off and needs the
`e2e-flag-overrides` cookie (gp-webapp
`app/shared/experiments/flagOverrides.ts`) to show the feature. The seed route and
the mock sink also need `OTEL_SERVICE_ENVIRONMENT` unset or a dev-only value
(see The seed route).

## Test command

```bash
npx vitest run src/constituentFeedback/
```
