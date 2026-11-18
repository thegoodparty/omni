# Case scout (caseScout)

The nightly case scout turns real chat failures into fictional universal-judge
cases. Each night it reads the day's chats, scores each session on Opus, drafts
a fictional case for the worst ones, runs every draft through the PII gate, and
hands the result to the publisher, which opens the PR. Design: the Universal
Judge Case Iteration TDD; decision record:
`docs/adr/2026-11-16-case-scout-reader-in-gp-api.md`.

**On in dev only.** Nothing runs unless `CASE_SCOUT_ENABLED=true`, which
only dev sets; prod and previews ship it `false`. The Python reader in
`packages/gp-ai/case_scout/reader/` is the same pipeline and stays runnable
until this one has had a good dev night.

**The publisher is not here, on purpose.** gp-api reads transcripts, so it
must never hold the GitHub App key. It writes the night's files to the scout's
bucket and invokes gp-ai's `case-scout-<env>` Lambda (`publisher.py`), which
holds the key and never sees a transcript.

## Flow

| Step                                          | Where                                  | What                                                                                                                                                                                      |
| --------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `caseScoutNightly` schedule, 09:17 UTC        | `services/caseScoutNightly.service.ts` | Claims the night, reads messages since the marker minus 60 minutes, splits sessions, caps at 75, writes `manifest.json`, sends one `caseScoutScoreSession` per session in a covered scope |
| `caseScoutScoreSession`, 4 at once fleet-wide | `services/caseScoutScore.service.ts`   | One Opus call; writes `scores/<sessionId>.json`; the last to finish sends `caseScoutDraft` keyed by the run                                                                               |
| `caseScoutDraft`, one at a time               | `services/caseScoutDraft.service.ts`   | Severity 2 and 3, worst first, up to the nightly cap; drafts and gates one at a time; writes the night's files; invokes the publisher                                                     |

Covered scopes are `chief_of_staff` and `campaign_assistant`
(`COVERED_SCOPES` in `caseScout.config.ts`). Other sessions count toward the
session cap and the marker but are never sent to a model.

| File                                    | Holds                                                                                                                        |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `caseScout.prompts.ts`                  | The scoring, drafting and second-read prompts, word for word the Python reader's                                             |
| `services/caseScoutMessages.service.ts` | The Prisma read that replaced the `case_scout_messages` Databricks view: staff filter, tool calls, per-conversation denylist |
| `services/caseScoutModel.service.ts`    | The three model calls; never any tools                                                                                       |
| `util/gate.util.ts`                     | The PII gate: denylist, 8-word copy, contact patterns, second read, schema                                                   |
| `schemas/caseScoutBucket.schema.ts`     | Every bucket object's shape                                                                                                  |
| `schemas/draftedCase.schema.ts`         | Mirror of `ChatCaseSchema` (see Gotchas)                                                                                     |

## Bucket (`case-scout-<env>`)

| Key                                                       | Written by                               | Read by                                     |
| --------------------------------------------------------- | ---------------------------------------- | ------------------------------------------- |
| `claims/<runId>`, `claims/<runId>.reader`                 | nightly, create-only                     | Either path: whoever claims a night runs it |
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
`CASE_SCOUT_SPEND_CAP_USD`, `CASE_SCOUT_SESSION_CAP`,
`CASE_SCOUT_JUDGE_RECORDS_BUCKET` (dev only: noisy-case proposals read the
judge's sweep records; unset skips them). Set in `deploy/index.ts`, with the
task role's grants on the bucket and the Lambda. Only prod drops staff and
test accounts (`OTEL_SERVICE_ENVIRONMENT`), as the Python reader did.

## Gotchas

- **`ChatCaseSchema` cannot be imported here.** `src/chats/evals/**` is left
  out of the production build, so `schemas/draftedCase.schema.ts` mirrors it
  and `draftedCase.schema.test.ts` pins the mirror to the real schema.
- **Never log chat text.** Logs and job payloads carry ids and counts only.
  Model spans record neither inputs nor outputs.
- **Prompts are graded.** The quality bench
  (`packages/gp-ai/case_scout/bench/README.md`) graded these exact prompts,
  and still runs the Python copy. Keep the two copies identical until the
  bench is ported, and run it before and after any prompt change.
