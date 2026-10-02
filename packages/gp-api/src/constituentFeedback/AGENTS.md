# constituentFeedback

Issue capture, on Win and Serve. A canvasser or caller records a short spoken
summary of one conversation; the request extracts the issue, the person's
position on it, and the outcome they want, and hands that back for the person
who was just there to confirm or correct. The module keeps its name; the user
never sees it.

Collection only. Clustering those rows into ranked themes, and the reporting
over them, is a separate phase and deliberately not here.

## Key files

| File                                                | Purpose                                     |
| --------------------------------------------------- | ------------------------------------------- |
| `constituentFeedback.controller.ts`                 | Routes under `/v1/constituent-feedback`     |
| `services/constituentFeedback.service.ts`           | Resolve, upsert, confirm, read              |
| `services/constituentFeedbackExtraction.service.ts` | The triple, via `LlmService.jsonCompletion` |
| `schemas/listConstituentFeedback.schema.ts`         | Query DTO for the read route                |

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

- `POST /` — record a memo. Extracts in the request and returns the proposed
  triple. `@AllowVolunteer()`.
- `PATCH /:id/confirm` — the confirmed triple. Sets `confirmedAt`.
  `@AllowVolunteer()`.
- `GET /?personId=` — that person's memos, newest first. Default posture:
  owner or campaign manager (a volunteer gets 403), since it is the CRM's
  record of a person.

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

## The extraction prompt names no product

The same three fields land on a voter's record and a constituent's, and the
copy around them is mode-keyed by the UI. So the prompt says "the person they
spoke with", never voter or constituent: a product noun there steers the
model into writing one product's word into the other's record.
`constituentFeedbackExtraction.test.ts` asserts neither word appears.

## Why extraction is synchronous

It would be cheaper on a queue. It is in the request because the confirmation
step needs the person who heard the conversation, and that person is only
present for the few seconds after they stop speaking. Deferred extraction
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
- **`audioKey` is null on every row.** Dictation streams to Transcribe over a
  live socket and no audio is persisted. The column exists so the offline path
  lands additively.

## Test command

```bash
npx vitest run src/constituentFeedback/
```
