# Case scout (caseScout)

The nightly case scout turns real chat failures into fictional universal-judge
cases. Each night it reads the day's chats, scores each session on Opus, drafts
a fictional case for the worst ones, runs every draft through the PII gate, and
hands the result to the publisher, which opens the PR. Design: the Universal
Judge Case Iteration TDD; decision record:
`docs/adr/2026-11-16-case-scout-reader-in-gp-api.md`.

**On in dev only.** Nothing runs unless `CASE_SCOUT_ENABLED=true`, which
only dev sets; prod and previews ship it `false`.

**The five `cases/<agent>.json` files are the scout's inbox only.** The
publisher appends a scout-drafted case to the agent's list, and the scout's
bench reads them back to check that a draft parses once appended. No judge runs
them: the harness that did is deleted, so the files carry no verdicts and a
change to one has no effect on any gate. They go when the publisher moves to
the Delegate webhook.

**The publisher is not here, on purpose.** gp-api reads transcripts, so it
must never hold the GitHub App key. It writes the night's files to the scout's
bucket and invokes gp-ai's `case-scout-<env>` Lambda (`publisher.py`), which
holds the key and never sees a transcript.

## Flow

| Step                                          | Where                                  | What                                                                                                                                                                                                                                                                   |
| --------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `caseScoutNightly` schedule, 09:17 UTC        | `services/caseScoutNightly.service.ts` | Claims the night, reads messages since the marker minus 60 minutes (no marker: the last 24 hours, `FIRST_NIGHT_WINDOW_HOURS`, plus the same 60), splits sessions, caps at 75, writes `manifest.json`, sends one `caseScoutScoreSession` per session in a covered scope |
| `caseScoutScoreSession`, 4 at once fleet-wide | `services/caseScoutScore.service.ts`   | One Opus call; writes `scores/<sessionId>.json`; the last to finish sends `caseScoutDraft` keyed by the run                                                                                                                                                            |
| `caseScoutDraft`, one at a time               | `services/caseScoutDraft.service.ts`   | Severity 2 and 3, worst first, up to the nightly cap (3; moves with the merge share of proposals a person ruled on); drafts and gates one at a time; writes the night's files; invokes the publisher                                                                   |

Covered scopes are `chief_of_staff` and `campaign_assistant`
(`COVERED_SCOPES` in `caseScout.config.ts`). Other sessions count toward the
session cap and the marker but are never sent to a model.

| File                                    | Holds                                                                                                                                                                                                                             |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `caseScout.prompts.ts`                  | The scoring, drafting and second-read prompts, as the quality bench graded them                                                                                                                                                   |
| `services/caseScoutMessages.service.ts` | The Prisma read that replaced the `case_scout_messages` Databricks view: staff filter, tool calls, per-conversation denylist                                                                                                      |
| `services/caseScoutModel.service.ts`    | The three model calls; never any tools                                                                                                                                                                                            |
| `util/gate.util.ts`                     | The PII gate: denylist, 8-word copy (from every role and tool input, only when the source run carries a number or a mid-sentence capital), contact patterns, second read, schema; `outboundStrings`, every field allowed to leave |
| `schemas/caseScoutBucket.schema.ts`     | Every bucket object's shape                                                                                                                                                                                                       |
| `schemas/draftedCase.schema.ts`         | Mirror of `ChatCaseSchema` (see Gotchas)                                                                                                                                                                                          |

## Bucket (`case-scout-<env>`)

| Key                                                       | Written by                               | Read by                                     |
| --------------------------------------------------------- | ---------------------------------------- | ------------------------------------------- |
| `claims/<runId>`                                          | nightly, create-only                     | nightly: one run a night                    |
| `marker.json`                                             | the publisher only                       | nightly                                     |
| `runs/<runId>/manifest.json`                              | nightly, create-only                     | score, draft                                |
| `runs/<runId>/scores/<sessionId>.json`                    | score, create-only                       | score (spend total), draft                  |
| `runs/<runId>/sources.json`, `record.json`, `bundle.json` | draft                                    | the publisher                               |
| `ledger/<yyyy-mm>.jsonl`                                  | draft, and the publisher's outcome lines | draft, the publisher                        |

`runId` is the UTC date. The publisher's half of the contract is pinned by
`fixtures/publisherContract/`: `tests/caseScout.jobs.test.ts` asserts the
writer produces exactly those files, and
`packages/gp-ai/case_scout/tests/test_gp_api_contract.py` publishes them.
Change both sides together.

## Retries

- **Nightly** resumes its own claim (the claim body names gp-api) and reuses
  the manifest if one exists.
- **Score** skips a session that already has a score. A parse failure is
  retried once in the call; a call failure is left to the job's retries, and
  the last attempt, timed out or not, writes a failed score before throwing,
  so one dead letter cannot strand the night. Only a shutdown skips it,
  because a shutdown requeues the attempt instead of spending it.
- **Draft** writes `bundle.json` last. If it exists, the job only re-invokes
  the publisher, and not even that once `marker.json` names the run. The
  publisher is idempotent per run except that it reposts its Slack note.
  Before `bundle.json`, a retry drafts again from scratch and its ledger lines
  replace the earlier attempt's.
- **The Lambda invoke** is one attempt with a 310-second read timeout, above
  the Lambda's 300: RequestResponse has no idempotency token. A `failed`
  publish throws, so the job retries and finally dead-letters, which pages.

## Spend

A flat $0.75 per call, an estimate about 7 times the real price, against
`CASE_SCOUT_SPEND_CAP_USD` (default $50). The cap reads the night's running
total from `scores/` before each score call, so with four score jobs in flight
the score stage can pass the cap by up to 4 calls ($3.00); drafting is
sequential and passes it by at most one. A capped session is never marked
processed, so a later night reads it.

## Config

`CASE_SCOUT_ENABLED`, `CASE_SCOUT_BUCKET`, `CASE_SCOUT_LAMBDA_FUNCTION_NAME`,
`CASE_SCOUT_SPEND_CAP_USD`, `CASE_SCOUT_SESSION_CAP`. Set in `deploy/index.ts`, with the
task role's grants on the bucket and the Lambda. Only prod drops staff and
test accounts (`OTEL_SERVICE_ENVIRONMENT`), as the Python reader did.

## Eval suites

Two expected-result suites (`defineExpectedResultEvalSuite` in
`@goodparty_org/judge`; that package's `AGENTS.md` has the shape). Each case
runs three attempts, and every attempt must deep-equal `expected`.

| Suite                                                       | In                                       | Judgment                                                                                               |
| ----------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `case_scout_deidentifier` (`caseScoutDeidentifier.eval.ts`) | An invented source session               | `{ draft, released }`, each `{ leaksPlanted, copiesSource, revealsSensitiveFact }`; expected all false |
| `case_scout_gate` (`caseScoutGate.eval.ts`)                 | A hand-written draft or needs-setup line | `{ blocked, rule }`, as a person rules it                                                              |

The de-identifier suite runs the job's own drafter (`draftCandidate`), the
gate with its live second read, and `outboundStrings`, the one list of
drafter-written strings that can leave prod. `draft` grades the drafter's raw
output; `released` is the same result, kept only when the gate let it through.
`leaksPlanted` and `copiesSource` are code (`copiesSource`: an 8-word run
copied from any role or tool input that carries a name, place or number);
`revealsSensitiveFact` is one `judgeModel` call, counted only when its quoted
span is in the text. The gate's copy check applies the same test as
`copiesSource` (a digit, or a word capitalized mid-sentence other than "I"),
because copied conversation is fine without PII in it; each file keeps its own
code, so the eval measures the gate rather than echoing it. The drafter's
outcome and the gate rule are annotations, never the judgment. The gate suite
expects today's misses to be caught (a seven-digit phone, a draft with no name
that still identifies a place), so its red cases are the gate's work list.

```bash
JUDGE_MODEL=anthropic/claude-sonnet-5-5 npm run eval -w packages/gp-api
npm run eval -w packages/gp-api -- caseScoutGate   # second read only, no JUDGE_MODEL
```

Both need `ANTHROPIC_API_KEY`, and the model calls honor `ANTHROPIC_BASE_URL`,
so unset it if your shell points it at a proxy. A full run of both takes about
six minutes and an estimated $4.

**Prod stays off until** the de-identifier suite shows zero leaks, raw and
released, on three consecutive full runs; the gate suite is fully green; the
quality bench's released-case count is no lower than its last run; and a person
reads the first 20 prod payloads before anything is sent onward.

**Every session and draft in both files is invented.** omni is public, so a
name, a town and a number there are fiction: 555-01xx numbers, example.com
addresses, people and towns that do not exist in real US states. Never commit a
real sample, and never load one into a report: the annotations record the
drafter's output.

## Gotchas

- **`ChatCaseSchema` cannot be imported here.** `src/chats/evals/**` is left
  out of the production build, so `schemas/draftedCase.schema.ts` mirrors it
  and `draftedCase.schema.test.ts` pins the mirror to the real schema. The real
  schema still loads the same five files, which is why it stays.
- **Never log chat text.** Logs and job payloads carry ids and counts only.
  Model spans record neither inputs nor outputs.
- **Prompts are graded.** The quality bench
  (`src/chats/evals/caseScoutBench/README.md`) drives these prompts, the
  model calls and the gate. Run it and the eval suites before and after any
  prompt or gate change. The bench, the job and the eval share
  `draftCandidate` and `buildDraftedCase` (`util/drafting.util.ts`); keep the
  bench's `runner.ts` in step with the job's other per-candidate rules.
- **A needs-setup line is gated too.** One that fails leaves as
  `WITHHELD_NEEDS_SETUP`, in the bundle and the ledger, with the rule in
  `gateFailures`. That is a second second-read call, counted in the spend.
