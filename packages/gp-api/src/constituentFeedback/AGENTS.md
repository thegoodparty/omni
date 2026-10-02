# constituentFeedback

Issue capture, on Win and Serve. A canvasser or caller records a short spoken
summary of one conversation; the request extracts the issue, the person's
position on it, and the outcome they want, and hands that back for the person
who was just there to confirm or correct. The module keeps its name; the user
never sees it.

An effort's confirmed memos are then synthesized into ranked themes, each
proposing a tag for the org's list, and read back as the effort's report.

With no signal, the phone records the memo instead and sends it later; the
server transcribes it, extracts, and the memo waits in "Notes to review"
for confirmation (see Offline memos).

## Key files

| File                                                | Purpose                                              |
| --------------------------------------------------- | ---------------------------------------------------- |
| `constituentFeedback.controller.ts`                 | Routes under `/v1/constituent-feedback`              |
| `services/constituentFeedback.service.ts`           | Resolve, upsert, confirm, read                       |
| `services/constituentFeedbackExtraction.service.ts` | The triple, via `LlmService.jsonCompletion`          |
| `services/feedbackSynthesis.service.ts`             | `requestRun`: floor, cooldown, run row, engine start |
| `services/synthesisEngine.ts`                       | The engine seam and its `SYNTHESIS_ENGINE` token     |
| `services/pipelineSynthesisEngine.ts`               | CSV to S3, trigger the polls pipeline                |
| `services/mockSynthesisEngine.ts`                   | In-process stand-in for laptops and dev              |
| `services/feedbackSynthesisIngest.service.ts`       | The one write path for a run's results               |
| `services/feedbackReport.service.ts`                | The effort report and theme page, counted at read    |
| `services/issueTag.service.ts`                      | Tag list and curation: accept, rename, merge, retire |
| `services/issueTagSeed.service.ts`                  | Win: accepted tags from declared positions           |
| `services/feedbackSeed.service.ts`                  | Dev-only fake memos on an effort                     |
| `services/synthesisStaleRunSweep.service.ts`        | Fails runs that never reported back                  |
| `services/pendingTranscription.service.ts`          | Offline memos: polls Transcribe, then extracts       |
| `util/issueTagName.util.ts`                         | `normalizedName`, always derived server-side         |
| `util/devOnlyRoute.util.ts`                         | The deploy gate on the seed and the mock audio sink  |
| `schemas/`                                          | Query DTOs for the three list routes                 |

Request/response shapes are in `@goodparty_org/contracts`
(`src/constituentFeedback/`), not here — the webapp is the consumer.

## Prisma model

`ConstituentFeedback` — via `this.model` / `this.client.constituentFeedback`.
Enums: `ConstituentFeedbackChannel`, `ConstituentFeedbackStance`,
`ConstituentFeedbackCaptureMethod`, `ConstituentFeedbackExtractionStatus`.

## Tables

The effort is the `Outreach` envelope: one key for a turf or a phone list.

- `ConstituentFeedback.outreachId`: the memo's effort, resolved at capture.
  A knock memo takes the knock row's own `outreachId` and falls back to the
  stop target's turf only when that is null; the question comes from the same
  envelope. A knock with neither 404s; a call on a list with no envelope saves
  with null (a Win list made without a Campaign row has no envelope).
- `ContactInteractionDoorKnock.outreachId`: the knock's effort, written by
  the door-knocking write path. Null on knocks recorded before it existed, and
  on manual CRM knock logs, which belong to no effort.
- `IssueTag`: the org's tag list, unique on
  `(organizationSlug, normalizedName)`. `IssueTagStatus`: proposed, accepted,
  retired.
- `ConstituentFeedbackTag`: a tag on a memo. `runId` null means a human
  applied it.
- `FeedbackSynthesisRun`: one synthesis over an effort or the whole org.
  `activeKey` is unique while running, so one run is in flight per scope.
  Superseded runs are kept as history.
- `FeedbackTheme`: one ranked grouping a run produced, linked to a tag.
- `FeedbackThemeMember`: a memo in a theme. Counts are computed from these
  rows at read time, never stored.

A run never overwrites a human's tag row. It skips any
`ConstituentFeedbackTag` pair that already exists, and superseding a run
deletes only the rows carrying its `runId`.

## HTTP routes

All under `@Controller('constituent-feedback')`, all `@UseOrganization()`.

- `POST /`: record a memo. With a `transcript`, extracts in the request and
  returns the proposed triple. With an `audioKey` (the offline path), saves
  it pending and starts a transcription job. `@AllowVolunteer()`.
- `PATCH /:id/confirm`: the confirmed triple. Sets `confirmedAt`.
  `@AllowVolunteer()`.
- `POST audio-upload-url`: `{ clientKey }` to `{ audioKey, uploadUrl,
expiresAt }`. `@AllowVolunteer()`.
- `PUT audio-upload/:clientKey`: the mock-mode upload sink; 404 otherwise.
  `@AllowVolunteer()`.
- `GET pending?outreachId=`: the effort's unconfirmed memos, newest first.
  `@AllowVolunteer()`; a volunteer gets only the ones they recorded.
- `POST :id/retry`: transcribe or extract a pending memo again.
  `@AllowVolunteer()`; a volunteer only on their own memo.
- `GET /?personId=`: that person's memos, newest first, with their accepted
  tags. Default posture: owner or campaign manager (a volunteer gets 403),
  since it is the CRM's record of a person.
- `GET efforts/:outreachId/report`: denominators, the latest run, themes.
- `POST efforts/:outreachId/synthesize`: start a run. 422
  `{ confirmed, required }` under the floor, 429 in the cooldown, 409 while
  one is in flight.
- `GET themes/:id`: one theme with its confirmed members.
- `GET tags?status=` and `PATCH tags/:id`: the tag list and its curation.
- `POST seed`: dev-only fake memos; 404s on prod.

The report, synthesis, theme and tag routes are default posture: what
people said across an effort, and the org's vocabulary for it, are the
manager's.

The writes admit volunteers because the person who had the conversation is
who records and confirms it, the posture the knock and call routes already
carry, and under the same rule: a volunteer acts only on an effort they hold
an `OutreachAssignment` on (`assertVolunteerAssignedToOutreach`, the knock
routes' predicate). Capture checks the resolved `outreachId` before it spends
an extraction; confirm checks the row's. A volunteer gets the same 404 the
knock or call route would give ("Stop target not found" / "Phone banking list
not found"), including for a memo with no effort, which nothing can be
assigned to. Owners and campaign managers are unaffected.

Every route is flag-gated and 404s when the flag is off, so a surface a user
has not been rolled out to does not advertise itself. The flag is the org's
product's: an `eo-` slug reads `serve-issue-capture`, anything else
`win-issue-capture`, so each product rolls out on its own schedule. Unlike
`outreachServeSms.controller.ts`, which gates only its writes, there is no
inert read here — the reads are the feature. `@UseOrganization()` and its role
guard are the access check; the flag gates rollout, not access.

## Synthesis

`requestRun` loads the effort's confirmed memos, refuses under
`MIN_CONFIRMED_FOR_SYNTHESIS` (5, provisional) and inside
`SYNTHESIS_COOLDOWN_MS` (10 minutes since the last completed run), inserts a
`running` run, and hands the memos to the engine. Two ways in: the report's
button, and the effort completing (a turf's Done in
`doorKnockingTurf.service.ts`, a list's last call in
`phoneBankingCall.service.ts`), which calls `requestRunOnEffortCompleted`
fire-and-forget and swallows the three refusals. That path has no request to
flag-gate, so it checks the floor and then the product's flag for the org's
owner itself; turning a flag off stops automatic runs too. The first run of a Win org
seeds accepted tags from its `CampaignPosition`s first.

- **The race guard is the index.** `activeKey` is
  `<org>:<outreachId>` while a run is in flight and unique, so the button and
  the trigger racing each other cannot both insert. The P2002 maps to 409.
  There is no read-then-insert check, on purpose.
- **Two engines, one ingest.** `FEEDBACK_SYNTHESIS_ENGINE=mock|pipeline`
  (unset is `pipeline`) picks the engine at boot; any other value, or a
  `FEEDBACK_SYNTHESIS_MOCK_GROUPING` other than `llm|canned`, fails boot.
  The pipeline engine writes `feedback-input/{runId}.csv` to
  `SERVE_ANALYSIS_BUCKET_NAME` (outside `input/`, whose S3 notification
  would start the run a second time as a poll) and POSTs
  `AI_PIPELINE_BASE_URL/serve/messages/process`; the pipeline answers later
  with `feedbackSynthesisComplete` on the shared queue. The mock waits five
  seconds and builds the same event in-process, with one LLM call or, under
  `FEEDBACK_SYNTHESIS_MOCK_GROUPING=canned`, three fixed themes and no call.
  Both end in `FeedbackSynthesisIngestService.handle`, so a laptop run
  exercises the real write path. `.env.test` pins mock and canned.
- **An engine that cannot hand off fails the run itself**, freeing the
  `activeKey`. A run whose event never arrives is failed (`error: timeout`)
  after 30 minutes by the stale-run sweep, every ten minutes under
  `CronLockService`.

## The ingest

One transaction, claimed first with a conditional update on
`status = running`, so a redelivered event writes nothing twice.

- A theme's members are the union of the S3 rows at `responsesLocation`
  matching its title (the pipeline writes them; the mock sends null), its
  quotes, and its `memberIds`. Ids outside the run's effort or org are
  dropped and counted in the log. If no theme keeps a member, the run fails
  (`error: no_members_in_scope`) rather than superseding a good one.
- One tag per theme, by `normalizedName`: merged away follows
  `mergedIntoId` to its target (one hop; targets are accepted and merges
  re-point earlier ones); accepted is linked; retired is revived to
  `proposed`; proposed is relinked to this run; none is created `proposed`,
  `source: synthesis`. Relinking carries `updatedAt` over, so it
  does not count as a human touching the tag.
- **Old runs are kept.** The previous completed run for the scope becomes
  `superseded`; its themes and members stay as history. Its tag rows and its
  untouched proposals (`updatedAt = createdAt`) are deleted explicitly,
  because a status change cascades nothing. That happens before this run's
  tag rows are written, or a pair both runs applied would be lost.
- `ConstituentFeedbackTag` rows are written with `skipDuplicates`, which is
  what keeps a human's row on a pair the run also applies.
- After commit it fires `Issue Capture - Synthesis Completed` through
  `AnalyticsService`, attributed to the requester or, for a triggered run,
  the org's owner: `scope`, `outreachId`, `themeCount`, `confirmedCount`,
  `product`. Never a transcript, label or outcome.

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
themes to show, under the floor and while a run is in flight. `channel` is
the effort's own (a turf's envelope is `door_knock`, a list's `phone_bank`,
memo or no memo), and `floor` is `MIN_CONFIRMED_FOR_SYNTHESIS`, sent so the
page's "Themes appear after N" line cannot drift from the 422. The constant
lives in `feedbackReport.service.ts` because the synthesis service imports
that file, not the other way round.

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
five issues) on an effort that already has stop targets or list entries. A
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
   names another org's audio, and returns a 15-minute presigned PUT on
   `SPEECH_BUCKET`. `.webm` even for Safari's mp4: Transcribe reads the
   container, not the name.
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
   an `audioKey` and no transcript, oldest touch first, 25 a pass. It reads
   before it claims, so an idle minute writes no `cron_run` row. Per row:
   start the job if there is none, else poll it. On text it writes the
   transcript and runs extraction exactly as a live capture does
   (`completeTranscription`), leaving `confirmedAt` null. A failed job, an
   empty transcript, or a row untouched for an hour becomes `failed`. Every
   write is scoped by the job name, so a memo re-recorded or retried
   meanwhile is left to its own job. No deploy allowlist: it calls
   Transcribe only for memos recorded on its own database.
4. `GET pending` is the "Notes to review" list. `POST :id/retry` on a memo
   with a recording and no words resets it to pending and starts a new job;
   on one with words it extracts again. Confirming goes through the usual
   `PATCH /:id/confirm`, which is also how a typed triple is saved.

The same list is the retry path for any memo whose transcription or
extraction failed online.

**Mock mode.** `SPEECH_TRANSCRIBE_FILE_MODE=mock` (see `src/speech/AGENTS.md`
for the transcription half). The upload URL then points at
`{APP_ROOT}/api/v1/constituent-feedback/audio-upload/{clientKey}`: the
webapp's `/api` proxy, which adds the session, to `PUT
audio-upload/:clientKey` here, which keeps nothing. It is keyed by the
`clientKey` because the whole audio key runs past Fastify's 100-character
route parameter limit. The sink 404s outside mock mode or off a dev-only
deploy, and `app.ts` registers an `audio/*` body parser only in mock mode,
so no deployed route buffers audio. `.env.test` sets `mock`.

## The extraction prompt names no product

The same three fields land on a voter's record and a constituent's, and the
copy around them is mode-keyed by the UI. So the prompt says "the person they
spoke with", never voter or constituent: a product noun there steers the
model into writing one product's word into the other's record.
`constituentFeedbackExtraction.test.ts` asserts neither word appears. The
mock engine's grouping prompt follows the same rule.

## Why extraction is synchronous

It would be cheaper on a queue. It is in the request because the confirmation
step needs the person who heard the conversation, and that person is only
present for the few seconds after they stop speaking. The one exception is
a memo recorded with no signal: nobody is at the door when it is
transcribed, so the cron extracts it and the canvasser confirms it later
from "Notes to review". Deferred extraction
means corrections get made later by someone reading a transcript who was not
there, which is a different and much weaker claim about what a person
said.

A failed extraction never fails the request. `extract()` returns null, the row
persists with its transcript and `extractionStatus: failed`, and the surface
shows an empty triple to fill in by hand. The memo is the record worth
keeping.

## proposed\_\* vs the confirmed columns

`issueLabel` / `stance` / `desiredOutcome` hold what a human confirmed.
`proposedIssueLabel` / `proposedStance` / `proposedDesiredOutcome` hold what
the model said first. The diff between them is the correction rate, and it is
the labeled corpus the synthesis phase gets evaluated against — it cannot be
reconstructed later, which is why it is written here.

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
- **A re-record clears `confirmedAt`.** The update branch replaces the triple
  with a fresh model proposal, so any confirmation the old one earned is void.
  Leaving it set hands reporting a model guess wearing a human's signature,
  which is the one thing the column exists to prevent.
- **An overlong proposal is truncated, not rejected.** The response schema caps
  `issueLabel` at 120 and `desiredOutcome` at 1000 and the interceptor enforces
  that on the way out, so an unclamped string would save the row and then 500
  the request that saved it — the surface would show a capture failure for a
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

## Test command

```bash
npx vitest run src/constituentFeedback/
```
