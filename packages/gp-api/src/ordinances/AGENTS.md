# src/ordinances/ — ordinance drafting, QC, and the quality loop

Ordinance records for elected officials (Serve): CRUD + clarify answers, the
municipal-code sourcing pipeline, draft export, and **two coexisting quality
machines** — a manual single QC run and an SQS-driven improve loop. The chat
flow that authors drafts lives in `src/chats/general/ordinance-flow/`; this
module owns the records and everything that grades or revises them.

**Office-level framing:** the flow prompt is level-aware. `DistrictResolverService`
carries the position's BallotReady `level`; the handler threads it into
`OrdinanceFlowContext.officeLevel`, and `ordinanceFlowPrompt.ts` swaps every
municipal block for a bill/legislature variant when the office is `STATE` (or
`FEDERAL`): document vocabulary, the authority test (constitutional/federal
limits instead of state-preempts-municipal), current-law research (state
statutes, not the municipal `OrdinanceCodeRecord`), and the peer set for
comparables (other states; the card contract's `city` field carries the peer
state's name until the contract gains a jurisdiction shape). When the org's
position doesn't resolve, `officeLevel` is null and the flow defaults to the
municipal framing. The QC judge and reviser prompts are level-neutral
("enacting body", "legislative voice") so the quality loop never pushes a
state bill back into ordinance style.

## Key files

| File | Role |
|------|------|
| `controllers/ordinanceFlow.controller.ts` | All `/v1/ordinances` routes: CRUD, clarify answers, quality-report (manual run), quality-loop (start/cancel), quality-iterations, export |
| `ordinances.controller.ts` | `GET /organizations/:slug/ordinance-code` — persisted municipal-code record |
| `ordinances.constants.ts` | Loop constants (`MAX_QUALITY_LOOP_REVISIONS`, pinned `QUALITY_LOOP_MODELS`, timeouts), the shared `MANUAL_RUN_STALE_MINUTES` window, flag + env-var names |
| `services/ordinances.service.ts` | CRUD, `toResponse` (assembles `qualityRunStatus` + `qualityLoop`), manual QC claim-and-poll, loop pass-throughs, supersession hooks, manual-QC 409 while a loop runs |
| `services/ordinanceQualityLoop.service.ts` | Loop orchestrator: `start`/`cancel`/`supersedeOnEdit`/`handleStep`/`sweepStalled`/`listIterations` |
| `services/ordinanceQualityLoop.types.ts` | Start input/result, trigger, Segment event props |
| `services/ordinanceQualityReport.service.ts` | Six-check QC judge; returns `{ report, degradedCheckIds }`; exports `qualityReportInputHash` |
| `services/ordinanceDraftRevision.service.ts` | Reviser (editor-not-author): fixes only flagged checks, strict output schema, ≥50%-length guard → `OrdinanceRevisionGuardError`, resolves `sourceIdsToAdd` against on-record sources only |
| `services/ordinanceDispatch.service.ts` | Cron dispatching `find_existing_ordinances` agent experiments (sourcing) |
| `services/ordinanceCodePersist.service.ts` / `ordinanceCodeRead.service.ts` | Persist/read municipal-code records from experiment artifacts |
| `services/ordinanceExport.service.ts` | PDF/DOCX draft export |

Cost tracking: the Ordinance record carries three per-draft token counters,
each split input/output — the interactive guided flow
(`flow_input_tokens`/`flow_output_tokens`, from `ordinanceFlow.handler`'s
`onTurnUsage` hook via the shared chat-stream `onUsage` callback), the manual
quality-report run (`qc_*`, from `runQualityReport`), and the improvement loop
(`loop_*`, from the loop's fenced QC + reviser writes). `draftTokenTotals` in
`services/ordinanceCost.util.ts` sums all three; that is the single per-draft
rollup — never add `OrdinanceQualityIteration.tokens` on top, since those rows
hold the same loop spend as per-pass detail (feeding the iterations endpoint's
`totalTokens`) and would double-count. Tokens are stored, not dollars; cost is
derived via the pricing map (`estimateCostUsd`) in the same util at read/log
time.

Prisma: `prisma/schema/ordinance.prisma` (both machines' columns) +
`prisma/schema/ordinanceQualityIteration.prisma` (per-pass history — the
handler's position-resolution substrate, the terminal best-restore source,
and the offline eval corpus; the webapp shows no outcome/history UI — per
the design, the quality report card is the only quality surface, so the
`quality-iterations` endpoint currently has no webapp consumer).

## Two state machines — do not conflate them

| | **qualityRun\*** (manual, PR #863) | **qualityLoop\*** (SQS loop) |
|---|---|---|
| Columns | `qualityRunStatus/StartedAt/Error` (string status: `running`/`done`/`error`) | `qualityLoopStatus` (enum: `running` + 6 write-once terminals), `RunId`, `Iteration`, `UpdatedAt` + `OrdinanceQualityIteration` rows |
| Trigger | `POST :slug/quality-report` — atomic claim (10-min stale reclaim), in-process `void` runner, `claimedAt`-fenced writes; `GET` polls | auto (`saveDraft` hook — supersedes + restarts a running loop) or manual `POST :slug/quality-loop` (409 when running) |
| Work | one QC pass | QC → revise → QC …, up to `MAX_QUALITY_LOOP_REVISIONS`, one LLM step per SQS message |
| Judge | two-model fallback | pinned `QUALITY_LOOP_MODELS` (no opus) — fallback would swap the judge mid-loop |

Coexistence rules:

- Loop QC steps write `qualityReport` directly (loop-fenced) and **never touch
  `qualityRun*` columns** — those belong to the manual path.
- Manual `startQualityReport` throws `ConflictException` while a loop is
  `running`.
- Loop `start()`'s claim WHERE excludes a **live** manual run (`running` with
  `startedAt` inside the 10-min stale window) → `manual_run_active`.

## Loop semantics (`ordinanceQualityLoop.service.ts`)

- `start()`: an **auto** trigger first fence-flips a running loop to
  `superseded_by_edit` — before any decline guard, because auto means the
  draft just changed, so a declined restart (kill switch, redline, status,
  already passing) must not leave a zombie run grading replaced inputs. A
  **manual** trigger on a running loop returns `already_running` without
  superseding. Then the guards: flag (`serve-ordinance-quality-loop`,
  checked once) → `ORDINANCE_QUALITY_LOOP_ENABLED` env → `status === draft`
  → no redline (`{-`/`{+`) → non-empty draft → not already passing for the
  current hash → no live manual run → atomic conditional-`updateMany`
  claim. Enqueue failure → fenced flip to `failed`.
- `handleStep()`: receipt guards (missing/deleted/not-running/runId mismatch →
  ack-drop) → heartbeat `qualityLoopUpdatedAt` → **position resolution before
  any hash interpretation** (behind-frontier redelivery re-derives and
  re-enqueues the correct next step; only a frontier message with genuinely
  undone work may read a hash mismatch as a user edit → `superseded_by_edit`).
- Bar after each QC: flags 0 → `converged`; iteration ≥ max →
  `stopped_max_iterations`; flagged set not a **proper subset** of the
  previous → `stopped_not_improving` (flag→attention counts as resolved).
- Every `stopped_*` terminal restores the best iteration (fewest flags, tie
  fewest attentions, then earliest) — draft + its report — in the terminal
  write.
- Content-writing/success terminals (`converged`, `stopped_*`) carry two
  extra stale-draft guards: `evaluateBar` re-checks the current input hash
  against the frontier row's `inputHash` (the redelivered-frontier path
  skips the message-hash check), and the terminal `updateMany` fences on the
  graded `draftTitle`/`draftBody` — `saveDraft` persists the new draft
  before `start()` retires the old run, so the running fence alone can race
  it. Either rejection flips the run to `superseded_by_edit` (fenced on
  running + runId) and acks. `cancelled`/`failed`/`superseded_by_edit`
  flips are never content-fenced — ending a run must always be possible.
- All writes fenced on `(status running + runId)`; LLM-adjacent persists also
  fence `updatedAt` inside one `$transaction` (`optimisticLockingUpdate`
  can't join a transaction). Zero rows → re-read: status/runId changed →
  ownership truly lost → discard the LLM result, ack; still owned (a
  concurrent non-superseding write merely bumped `@updatedAt`) → return
  `false` so SQS redelivers the step (a mid-revise twin that already advanced
  the frontier instead enqueues the next qc with the twin's hash). Terminals
  are write-once.
- Degraded QC (missing/placeholder checks) retries once — attempts live on
  the iteration row, never in the message. LLM throw → fenced `failed` + ack.
- `sweepStalled` cron (`*/10`): `running` with `qualityLoopUpdatedAt` older
  than 30 min (or never set) → `failed`.
- Terminal → Segment `EVENTS.Ordinances.QualityLoopCompleted`.
- Supersession hooks: PATCH `update` (hash input or status-past-draft),
  `saveClarifyAnswer`, and chat tools `saveAuthority`/`saveComparables`/
  `saveExistingLaw` call `supersedeOnEdit`.

## Queue semantics

`QueueType.ORDINANCE_QUALITY_LOOP` — one message = **one LLM step**
(`phase: qc | revise`), consumer case dispatches to `handleStep` (see
`src/queue/CLAUDE.md` for queue-wide rules).

- `MessageGroupId = ordinance-quality-loop-{ordinanceId}`: serializes one
  ordinance's steps, parallel across ordinances.
- `deduplicationId = loopRunId:iteration:phase:attempt` (dedup is queue-wide,
  so ids embed the runId). All enqueues `throwOnError: true`.
- A step must fit the 300 s visibility window: one
  `AbortSignal.timeout(240_000)` per step + `retries: 1` per LLM call
  (`LlmService` treats AbortError as bail — no model cascade). The revise
  guard retry shares the step's signal, so it only spends what remains of
  the budget.
- Unexpected (non-LLM) handler error returns `false` → SQS redelivery
  (position resolution makes the retry safe) → DLQ on max receives.

## Testing / DB safety

Loop and race tests run against **real Postgres via `useTestService()`**
(`.env.test` + testcontainers) — the fenced-write races are the point. Never
run `prisma migrate dev` / `migrate reset` / `db push` / seed against the
`.env` `DATABASE_URL` (shared dev DB); create migrations with
`prisma migrate diff` (see `prisma/CLAUDE.md`).
