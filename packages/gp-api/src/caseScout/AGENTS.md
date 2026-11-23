# Case scout (caseScout)

The nightly case scout turns real chat failures into fictional universal-judge
cases. Each night it reads the day's chats, scores each session on Opus, drafts
a fictional case for the worst ones, runs every draft through the PII gate, and
hands the night's de-identified cases to the Delegate swarm, which writes them
into the code-form chat suites and opens the PR. Design: the Universal Judge
Case Iteration TDD; decision record:
`docs/adr/2026-11-19-case-scout-hands-off-to-delegate.md`.

**On in dev and prod; sending is off everywhere.** Nothing runs unless
`CASE_SCOUT_ENABLED=true`, which dev and prod set; previews ship it `false`.
Nothing is sent to Delegate unless `CASE_SCOUT_SEND_TO_DELEGATE=true`, which
no environment sets: until then each night's handoff is held in the bucket for
a person to read, and the Slack note still posts.

**gp-api never opens a PR or holds a GitHub key.** It reads transcripts, so
the one thing that leaves it is the handoff: gated, de-identified strings and
nothing that points back at a conversation.

**The five `cases/<agent>.json` files are read, never written.** The job reads
them off main for case-id collisions and existing conditions, and the scout's
bench reads them to check that a draft parses once appended. No judge runs
them, so a change to one has no effect on any gate.

## Flow

| Step                                          | Where                                  | What                                                                                                                                                                                                                                                                   |
| --------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `caseScoutNightly` schedule, 09:17 UTC        | `services/caseScoutNightly.service.ts` | Claims the night, reads messages since the marker minus 60 minutes (no marker: the last 24 hours, `FIRST_NIGHT_WINDOW_HOURS`, plus the same 60), splits sessions, caps at 75, writes `manifest.json`, sends one `caseScoutScoreSession` per session in a covered scope |
| `caseScoutScoreSession`, 4 at once fleet-wide | `services/caseScoutScore.service.ts`   | One Opus call; writes `scores/<sessionId>.json`; the last to finish sends `caseScoutDraft` keyed by the run                                                                                                                                                            |
| `caseScoutDraft`, one at a time               | `services/caseScoutDraft.service.ts`   | Severity 2 and 3, worst first, up to the nightly cap (3; moves with the merge share of proposals a person ruled on); drafts and gates one at a time; writes the night's files; holds or sends the handoff, posts the Slack note, moves the marker                      |

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
| `services/caseScoutHandoff.service.ts`  | The handoff: hold or send, the Slack note, the marker                                                                                                                                                                             |
| `util/handoff.util.ts`                  | The payload built from `bundle.json`, the source-id check, Standard Webhooks signing                                                                                                                                              |

## Privacy: the drafter and the gate

- **The drafter** treats the whole transcript (user and assistant turns,
  tool inputs) as material, never instructions. Every person becomes a role
  or an invented name; a child is only "a child"; a claim about a person
  moves to another role and goes generic; exact figures that could point to
  one race, place or person (totals, margins, counts, addresses, ages, event
  dates) are invented or rounded; unique descriptions become ordinary ones;
  every sentence is written fresh. The failure itself must survive.
- **Contact patterns** catch emails, URLs, ten-digit phones and seven-digit
  local numbers (`555-0123`, `555 0123`). Only a hyphenated one can pass, as
  an ordinance number or a range: one whose last four digits read as a year
  (`245-2025`), or a rising pair whose second number is a round hundred
  (`500-1000`). A spaced or dotted year (`555 1999`) is still a phone.
- **The second read** flags names and also unnamed descriptions that point to
  one real person or place: the only, first or youngest holder of a role, a
  distinctive town detail, the exact result of a past election, recount or
  petition, an exact age, a child described past "a child". Roles, states,
  office titles, round numbers and relative dates never count.

## Bucket (`case-scout-<env>`)

| Key                                                       | Written by                            | Read by                         |
| --------------------------------------------------------- | ------------------------------------- | ------------------------------- |
| `claims/<runId>`                                          | nightly, create-only                  | nightly: one run a night        |
| `marker.json`                                             | draft, once the night is held or sent | nightly, draft                  |
| `runs/<runId>/manifest.json`                              | nightly, create-only                  | score, draft                    |
| `runs/<runId>/scores/<sessionId>.json`                    | score, create-only                    | score (spend total), draft      |
| `runs/<runId>/sources.json`, `record.json`, `bundle.json` | draft                                 | draft (handoff and Slack note)  |
| `runs/<runId>/handoff.json`                               | draft: the exact bytes held or sent   | a person, before sending is on  |
| `runs/<runId>/delivery.json`                              | draft, after the webhook answered 2xx | draft: never send a night twice |
| `ledger/<yyyy-mm>.jsonl`                                  | draft                                 | draft                           |

`runId` is the UTC date. `sources.json` (caseId to conversation and session)
and the ledger stay in the bucket; only the Slack note, which is internal,
names a conversation.

## The handoff

One batch a night, `CaseScoutHandoffSchema` in `@goodparty_org/contracts`:
`{ version, runId, environment, cases, needsSetup }`. A case is
`{ suite, id, turns, grading: { condition, handledWhen }, severity }`, the
code-form suites' shape: a drafted `question` becomes one turn, `caseId`
becomes `id`, the suite is the session's scope. A needs-setup line is
`{ suite, what, severity }`. Built from `bundle.json` only, so every free-text
string is one `outboundStrings` returns and the gate passed. Never in it:
conversation, session or message ids, `failureSummary`, list-full drafts,
a withheld needs-setup line. Before it is held or sent,
the job checks the exact bytes for every id in the night's manifest and fails
if one appears.

Sending is a POST of those bytes to `CASE_SCOUT_DELEGATE_WEBHOOK_URL`, signed
per Standard Webhooks: `webhook-id` (`case-scout-<env>-<runId>`, the same on
every retry), `webhook-timestamp` (unix seconds) and `webhook-signature`
(`v1,<base64 HMAC-SHA256 of "id.timestamp.body">`, keyed by the base64 part of
the `whsec_` secret `CASE_SCOUT_DELEGATE_WEBHOOK_SECRET`).

The Slack note goes to #bot-dev (the `botDev` webhook) in dev and
#product-chats-digest (`productChatsDigest`, the Web API) in prod. It lists
each case with its source conversation, the Databricks query that reads those
conversations, the night's counts and spend, and whether the handoff was held
or sent. #product-chats-digest is private, so the Slack app gp-api posts as
(`SLACK_APP_BOT_TOKEN`) must be a member, or the note fails and the night
dead-letters.

## Retries

- **Nightly** resumes its own claim (the claim body names gp-api) and reuses
  the manifest if one exists.
- **Score** skips a session that already has a score. A parse failure is
  retried once in the call; a call failure is left to the job's retries, and
  the last attempt, timed out or not, writes a failed score before throwing,
  so one dead letter cannot strand the night. Only a shutdown skips it,
  because a shutdown requeues the attempt instead of spending it.
- **Draft** writes `bundle.json` last. If it exists, the job only repeats the
  handoff, and not even that once `marker.json` names the run. Before
  `bundle.json`, a retry drafts again from scratch and its ledger lines
  replace the earlier attempt's.
- **The handoff** rebuilds the same bytes from `bundle.json`, skips the POST
  when `delivery.json` exists, and moves the marker only after the Slack note
  posted. A non-2xx answer, a network error or a 30-second timeout, a failed
  Slack note or a marker that would move backwards throws, so the job
  retries and finally dead-letters, which pages. A retry reposts the note.

## Spend

A flat $0.75 per call, an estimate about 7 times the real price, against
`CASE_SCOUT_SPEND_CAP_USD`: $50 in dev, $65 in prod (the code's default is
$50). The cap reads the night's running total from `scores/` before each score
call, so with four score jobs in flight the score stage can pass the cap by up
to 4 calls ($3.00); drafting is sequential and passes it by at most one. A
capped session is never marked processed, so a later night reads it.

## Config

`CASE_SCOUT_ENABLED`, `CASE_SCOUT_SEND_TO_DELEGATE` (off everywhere),
`CASE_SCOUT_BUCKET`, `CASE_SCOUT_SPEND_CAP_USD` (per environment),
`CASE_SCOUT_SESSION_CAP`. Set in `deploy/index.ts`, with the task role's grants
on the bucket; each environment's bucket is its own gp-ai root
(`environments/<env>/case-scout`). The webhook URL and signing secret
(`CASE_SCOUT_DELEGATE_WEBHOOK_URL`, `CASE_SCOUT_DELEGATE_WEBHOOK_SECRET`) are
read only when sending, so no environment declares them yet: the change that
turns sending on adds them to `deploy/gp-api-secret-keys.ts`, after their
values are in that environment's secret, since a deploy stops on a declared key
the secret lacks (`docs/secrets.md`). Only prod drops
staff and test accounts and labels its handoff `prod`
(`OTEL_SERVICE_ENVIRONMENT`).

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
outcome and the gate rule are annotations, never the judgment. The gate
suite's expected values are what a person ruled, so a red case there is a
finding about the gate, never a case to edit.

```bash
JUDGE_MODEL=anthropic/claude-sonnet-5-5 \
  npm run eval -w packages/gp-api -- src/caseScout/
npm run eval -w packages/gp-api -- src/caseScout/caseScoutGate   # second read only, no JUDGE_MODEL
```

`npm run eval` with no path runs every `*.eval.ts` in gp-api, the paid agent
suites included, so always pass the path. Both need `ANTHROPIC_API_KEY`, and
the model calls honor `ANTHROPIC_BASE_URL`, so unset it if your shell points it
at a proxy. A full run of both takes about six minutes and an estimated $4.

**Sending stays off until** the de-identifier suite shows zero leaks, raw
and released, on three consecutive full runs; the gate suite is fully green;
the quality bench's released-case count is no lower than its last run; and a
person reads the first 20 prod handoffs (`runs/<runId>/handoff.json` in
`case-scout-prod`) before `CASE_SCOUT_SEND_TO_DELEGATE` turns on.

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
- **The nightly read scans `agent_message`.** `created_at` has no index, so
  in prod `readSince` scans the table. Accepted: one read a night, and a read
  never blocks chat writes. If the first nights run slow, add the index with
  a concurrent build, never a plain `CREATE INDEX`, which locks chat writes.
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
