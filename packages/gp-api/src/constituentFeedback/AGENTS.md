# constituentFeedback

Serve-side issue capture. A canvasser or caller records a short spoken summary
of one conversation; the request extracts the issue, the constituent's position
on it, and the outcome they want, and hands that back for the person who was
just there to confirm or correct.

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

## HTTP routes

All under `@Controller('constituent-feedback')`, all `@UseElectedOffice()`.

- `POST /` — record a memo. Extracts in the request and returns the proposed
  triple.
- `PATCH /:id/confirm` — the confirmed triple. Sets `confirmedAt`.
- `GET /?personId=` — that person's memos, newest first.

Every route is flag-gated on `serve-issue-capture` and 404s when it is off, so
a surface a user has not been rolled out to does not advertise itself. Unlike
`outreachServeSms.controller.ts`, which gates only its writes, there is no
inert read here — the reads are the feature.

`@UseElectedOffice()` is the real access check and what makes this Serve-only:
a Win org has no `ElectedOffice` row. The flag gates rollout, not access.

## Why extraction is synchronous

It would be cheaper on a queue. It is in the request because the confirmation
step needs the person who heard the conversation, and that person is only
present for the few seconds after they stop speaking. Deferred extraction
means corrections get made later by someone reading a transcript who was not
there, which is a different and much weaker claim about what a constituent
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
