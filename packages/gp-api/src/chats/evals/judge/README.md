# Universal Judge

Answers one question for any agent we run: **is this branch better, worse, or
the same as what it branches from?**

Nothing else. No thresholds, no per-agent rubric, no gold answers. Those are
absolute judgments, each needs a standard written per agent, and that is
exactly why agent eval coverage has stayed near zero. A comparison needs none
of it, which is the only reason one judge can cover every agent.

Design: the [TDD](https://goodparty.clickup.com/90132012119/v/dc/2ky4jq2q-20493/2ky4jq2q-139733)
and the shorter [review doc](https://goodparty.clickup.com/90132012119/v/dc/2ky4jq2q-20493/2ky4jq2q-140793).

## Asking for a judgment

You ask about a pull request, and the judge compares the PR's branch with what
it branches from (normally `main`).

**On the PR, comment `/judge`.** The bot replies with a plan: which agents it
would compare and what that would cost. No sweep runs and nothing is spent.
Then confirm it:

| Comment                                            | What it does                                                        |
| -------------------------------------------------- | ------------------------------------------------------------------- |
| `/judge`                                           | Plan only, for the agents your diff touched                         |
| `/judge --live`                                    | Runs it for those agents                                            |
| `/judge chief_of_staff --live`                     | Runs it for the agent you name                                      |
| `/judge chief_of_staff,opposition_research --live` | Several, comma-separated, no spaces                                 |
| `/judge all --live`                                | Every agent with a case list. Expensive; for changes to shared code |

The comment has to start with `/judge`. Only people with write access to the
repository can run one, because it spends on the organization's model
account. Fork PRs are skipped.

**Or from Actions.** Open **Actions → Universal Judge request → Run
workflow**, fill in the PR number and the agents (`auto` by default), and tick
**Actually run the sweep and spend on model calls** to spend. Leave it
unticked for the plan.

**Reading the result.** The verdict is in the run's summary: open **Actions →
Universal Judge comment** (or **request**, for a dispatch) and pick the run.
Every comment on any PR starts a comment run, most of them skipped, so look
for the one at the time you posted. The PR thread says the sweep started but
not how it ended, so the run is where to look. Each agent gets one verdict: **BETTER**, **WORSE**, **SAME** or
**CAN'T SAY**. Most are CAN'T SAY today, and that's expected for two reasons.
Almost all the case lists are still placeholders (see below), and every list
has fewer than the 20 cases a verdict needs to count as evidence. Under that it's CAN'T SAY, with the
measured difference still shown beside it. The summary also lists what was
excluded and why, and an agent that couldn't be compared is listed as
refused, with the reason.

A sweep of one chat agent takes about half an hour. The plan comment shows the
estimate before anything runs, priced from what each agent cost in an earlier
judge sweep, x1.5 and rounded up: about $9 for `chief_of_staff`, and $3 to $12
for a measured background agent at the default 3 cases. An agent never
measured is priced at a worst case and marked "(unmeasured)": $0.52 a chat
turn ($37.50 for 8 cases at 3 attempts), $8 a background run ($48 at 3 cases).
Each agent is priced at the highest of the PR's, the base ref's and the default
branch's tables, so a PR cannot lower its own estimate, and a chat agent pays
for both arms' case lists. The numbers and their evidence are in
`planCost.ts`; add an agent's measured cost there after its first live sweep
(the per-run mean on the report's `- cost difference per run pair:` line).

**What a sweep actually spent** is the first thing in its report: the total,
split into each arm's agent runs and the judge panel, beside the estimate.
Every record counts, including pairs excluded for an error and agents the
judge refused, because those runs were billed too. A run that recorded no
cost (a background run cancelled at its own timeout) or a panel call that
failed makes the total a lower bound, and the report says "at least" and why
rather than printing a low number as if it were measured. The reasons are a
fixed set: no cost recorded (a background run cancelled at its own timeout),
a model `pricing.ts` has no rates for, or a failed panel call. The closing summary
table prints the same total beside the estimate. One undercount nothing can
see: a model call retried inside `LlmService` or a chat turn's provider call
reports only the attempt that succeeded, so the report always carries a line
saying the figure can run slightly low.

**A second request on the same PR cancels the first**, from a comment or from
Actions. That includes a plan-only `/judge`: posting one while a live sweep is
running throws away what that sweep already spent, and no verdict comes out.

## Running a sweep: THREE PROCESSES, NOT ONE

This is the shape of the whole thing, and it is forced rather than chosen. An
arm is a worktree, two worktrees are two module graphs, and one Node process
cannot import both. So a sweep is three invocations:

| Step | Command                                                                       | Where                          |
| ---- | ----------------------------------------------------------------------------- | ------------------------------ |
| 1    | `JUDGE_ARM=base npx vitest run src/chats/evals/judge/sweep.eval.test.ts`      | the **base** worktree          |
| 2    | `JUDGE_ARM=candidate npx vitest run src/chats/evals/judge/sweep.eval.test.ts` | the **candidate** worktree     |
| 3    | `npx tsx src/chats/evals/judge/sweep.ts`                                      | either — it only reads records |

Steps 1 and 2 must be vitest: `useTestService()` registers
`beforeAll`/`beforeEach`/`afterAll` to stand up the Postgres container and the
authenticated app, and those hooks exist only inside a vitest process. Step 3
must NOT be: it is pure functions over stored records, and pure functions in a
vitest file cannot be invoked from a workflow step cleanly.

`.github/workflows/judge.yml` drives all three. The arms meet in the record
store and nowhere else.

**Configuration comes from the environment, not argv**, because a test file has
no argv. Every value is Zod-validated up front and a missing one is a sentence
naming it.

| Variable                                                                                 | Steps | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `JUDGE_ARM`                                                                              | 1, 2  | `base` or `candidate`. **Absent means the suite skips**, so `npm run verify` does not drive an agent.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `JUDGE_SWEEP_ID`                                                                         | all   | The directory the two arms meet in. Must be identical in all three.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `JUDGE_AGENTS`                                                                           | all   | Comma-separated agent ids.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `JUDGE_BASE_REF`                                                                         | 1, 2  | The base branch name, for `variant.ref`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `JUDGE_CANDIDATE_SHA`                                                                    | 1, 2  | The PR head commit the plan priced.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `JUDGE_ARM_COMMIT`                                                                       | 1, 2  | HEAD of _this_ checkout. On the candidate arm it must equal `JUDGE_CANDIDATE_SHA`, or the checkout is not the commit under test.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `JUDGE_RECORDS_DIR`                                                                      | all   | A local directory. Exactly one of this and the bucket.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `JUDGE_RECORDS_BUCKET`                                                                   | all   | An S3 bucket. What CI uses — see below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `JUDGE_SPEND`                                                                            | all   | Only the exact string `true` calls a real model. Anything else uses a canned reply, which is how the pipeline is exercised for nothing. **Step 3 spends too** — one panel call per judgeable pair, per seat — so all three must agree; step 3 refuses a setting that differs from what the arms' manifests recorded.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `JUDGE_DATA_VERSION`                                                                     | 1, 2  | The Delta version both arms read. Resolved ONCE by `dataVersion.ts` in a `sweep` step of its own, before either arm runs, and published as a step output both arms read: an arm that looked up "current" itself would look it up an hour after the other and get a different answer. Empty when the mart could not be read — no credential, a dead one, a history the warehouse will not hand over — which reads here as "not pinned". The sweep then proceeds against the live mart rather than refusing, because most agents never query it, and `report.ts` names every run that queried the mart anyway.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `JUDGE_BACKGROUND_ATTEMPTS` / `JUDGE_BACKGROUND_MAX_CASES` / `JUDGE_BACKGROUND_ADMITTED` | 1, 2  | The background case and attempt budget, and which background agents it admits, decided ONCE by `armBudget.ts` for both arms — after the base worktree exists and before either arm runs. The base arm reads the base ref's `config.ts` and manifests, so a budget or an admission each arm decided for itself would differ whenever a branch changed either, and with the budget spent down in walk order one disagreement moves every agent after it. Every admitted run starts at once and the arm is done when the slowest is, so an agent is admitted when one of its runs fits the arm on whichever arm is slower and its runs fit the `config.background.maxInFlight` slots left; one missing from the base ref is refused before anyone pays. The same step refuses, by name, a chat agent the base ref cannot run (blocked in its `agents.ts`, or with no case list there): the base arm would skip it and the candidate arm would pay for every turn with nothing to pair. Against a base ref whose arm still walks runs one after another (no `BACKGROUND_WALKS_CONCURRENTLY` in its `sweepArm.ts`), admission spends the arm's wall clock down run by run instead. `ATTEMPTS` switches the mode: present, a blank `MAX_CASES` means no cap and a blank `ADMITTED` means none admitted; absent, the arm decides for itself (a local run). Either of the other two without `ATTEMPTS` is refused as half a budget. A base ref older than these inputs ignores them. |
| `JUDGE_FIXTURE_ORG_SLUG` / `JUDGE_FIXTURE_RACE_ID` / `JUDGE_FIXTURE_USER_EMAIL`          | 1, 2  | The identifiers six background case lists cannot carry, resolved ONCE by `judgeIdentifiers.ts` for both arms: a `judge-` slug from the sweep id, a BallotReady race id, a reserved address. The three agents that read gp-api use the fixed `judge-fixture` slug instead. Empty reads as "not resolved", and every background agent is then refused by name before anything is staged. See [Six background agents need identifiers a case list cannot carry](#six-background-agents-need-identifiers-a-case-list-cannot-carry).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `JUDGE_SELECTION`                                                                        | all   | `explicit` when the request NAMED the agents (`/judge chief_of_staff`, or `all`), `auto` when the diff derived them. Only the exact string `explicit` changes anything, so an empty or garbled value leaves every refusal armed. On `explicit` the two sameness refusals below become qualifiers in the report instead: the digest is the rendered prompt plus the tool names, so a branch that changes only the model, the provider, the sampling settings or a tool's implementation hashes identically, and refusing to judge it would refuse the comparison somebody asked for. Resolved once by judge.yml's `select` step and read by all three processes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `JUDGE_ANTHROPIC_API_KEY`                                                                | 1, 2  | The real Anthropic key, and it cannot arrive as `ANTHROPIC_API_KEY`: `vitest.config.ts` applies `.env.test` over the process environment and `.env.test` defines that name as a stub, so a key exported under it is replaced before any test line runs — which is how the first live sweep spent two arms collecting `invalid x-api-key`. `modelKey.ts` moves this into place at module scope, ahead of the app boot that constructs LlmService. **Required when `JUDGE_SPEND=true`** and ignored otherwise, so a dry run keeps the stub and cannot reach the real API. Export it in the shell; a `.env` file will not do it, because nothing on this path loads one.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `JUDGE_AWS_ACCESS_KEY_ID` / `JUDGE_AWS_SECRET_ACCESS_KEY` / `JUDGE_AWS_SESSION_TOKEN`    | 1, 2  | The credentials for staging and dispatching a background agent, under these names for the same reason as the key above: `.env.test` stubs `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`, so credentials exported under the SDK's own names arrive as a stub key, and AWS refuses it. `awsCredentials.ts` hands them to the judge's own S3 and SQS clients and nothing else; the app under test keeps the stubs. judge.yml passes the role's; locally, export these to run a background agent. Not needed for a chat-only sweep.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `AI_MODELS`                                                                              | 3     | LlmService refuses to construct without it. It is the default fallback chain, which the panel never reaches — each seat pins its own model — so step 3 derives it from `panel.seats` when the environment has not set it. Steps 1 and 2 get it from `.env.test`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `JUDGE_CANDIDATE_REF`                                                                    | 1, 2  | Optional. The head ref name, for readability.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `JUDGE_PR_NUMBER`                                                                        | all   | Optional.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

Exercise it locally, free, in one checkout:

```bash
export JUDGE_SWEEP_ID=local-1 JUDGE_AGENTS=chief_of_staff \
       JUDGE_BASE_REF=main JUDGE_RECORDS_DIR=/tmp/judge \
       JUDGE_CANDIDATE_SHA=$(git rev-parse HEAD)
JUDGE_ARM=base      JUDGE_ARM_COMMIT=$(git rev-parse HEAD~1) \
  npx vitest run src/chats/evals/judge/sweep.eval.test.ts
JUDGE_ARM=candidate JUDGE_ARM_COMMIT=$JUDGE_CANDIDATE_SHA \
  npx vitest run src/chats/evals/judge/sweep.eval.test.ts
npx tsx src/chats/evals/judge/sweep.ts
```

To make that recipe spend, add `JUDGE_SPEND=true` **and** export
`JUDGE_ANTHROPIC_API_KEY` in the same shell. Without the second one the arms
refuse to start rather than authenticating with the stub.

Step 3 will **refuse**, because one checkout gives both arms the same
`configDigest`. That is the refusal working, not a failure. Add
`JUDGE_SELECTION=explicit` to all three to get a report instead, with a
qualifier saying the arms were configured alike — which is what the workflow
does for a request that named its agents.

**A background agent needs two more steps first**, the ones judge.yml runs
before either arm: the budget (`armBudget.ts`) and the identifiers
(`judgeIdentifiers.ts`). Each appends `key=value` lines to a file, and the arms
read them as env:

```bash
export JUDGE_SWEEP_ID=local-bg-1 JUDGE_AGENTS=race_opponent_summary
BASE_DIR=$(git rev-parse --show-toplevel) \
  npx tsx src/chats/evals/judge/armBudget.ts /tmp/judge-budget
JUDGE_FIXTURE_API_URL=https://gp-api-dev.goodparty.org \
  npx tsx src/chats/evals/judge/judgeIdentifiers.ts /tmp/judge-ids
while IFS='=' read -r key value; do
  case $key in
    attempts)      export JUDGE_BACKGROUND_ATTEMPTS=$value ;;
    max_cases)     export JUDGE_BACKGROUND_MAX_CASES=$value ;;
    admitted)      export JUDGE_BACKGROUND_ADMITTED=$value ;;
    refused)       export JUDGE_BACKGROUND_REFUSED=$value ;;
    arm_budget_ms) export JUDGE_ARM_BUDGET_MS=$value ;;
    org_slug)      export JUDGE_FIXTURE_ORG_SLUG=$value ;;
    race_id)       export JUDGE_FIXTURE_RACE_ID=$value ;;
    user_email)    export JUDGE_FIXTURE_USER_EMAIL=$value ;;
  esac
done < <(cat /tmp/judge-budget /tmp/judge-ids)
```

`BASE_DIR` is the base checkout's repo root; in one checkout it is this one.
Then run the three steps above with `JUDGE_SPEND=true`, the Anthropic key and
the `JUDGE_AWS_*` credentials, since a background agent dispatches for real.

**Vitest exiting 0 does not mean the agent ran.** An arm that is missing any of
these skips the agent and records why in its manifest,
`$JUDGE_RECORDS_DIR/_judge/<sweepId>/manifests/<arm>.json` under `skipped`.
Read that before reading step 3's report.

The arm log often ends in a Peerly stack trace. It is the test app's Peerly
client trying to log in at boot (`@Timeout(0)` on
`PeerlyHttpService.authenticate`) with `.env.test`'s stub credentials, and no
judged agent calls Peerly. It is noise, not the failure.

## Databricks access

The chat arms and the data-version step read constituent data as the judge's
own service principal, from the `JUDGE_DATABRICKS_CLIENT_ID` and
`JUDGE_DATABRICKS_CLIENT_SECRET` repository secrets. That principal needs
`USE CATALOG` on `goodparty_data_catalog`, `USE SCHEMA` on `mart_serve_agents`,
`SELECT` on `serve_agent_voters`, and `CAN USE` on the SQL warehouse. Until
those secrets exist, the callers fall back to the shared analytics principal,
which has no grant on the catalog, so the data version is not pinned and
constituent tools fail.

Campaign Manager's Win credential (`WIN_DATABRICKS_*`) is not passed. The data
version is read from the Serve mart and applied to every agent's tables, so
the Win mart needs its own version before Campaign Manager can query it here.

## The arms are sequential, and the TDD says otherwise

The TDD claims the orchestrator alternates arms in time — "base, candidate,
base, candidate" — so that a mid-sweep deploy or shifting data cannot pass for
a variant difference. **For chat that is not achievable**, for the reason above:
each arm is a separate process in a separate checkout. All of base runs, then
all of candidate. **The doc needs correcting.**

What happens instead (`armGap.ts`): each arm stamps when its capture started
and finished, the report prints the distance between the two windows, and a
comparison whose arms are further apart than `config.armGap.maxHours` is
flagged. The reader is told how long the world had to move rather than
reassured it was zero. This is the same treatment the background runner's
cached base arm already gets, so it is consistent rather than a special case.

## What is here

| File                                                   | What it is                                                                     |
| ------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `record.ts`                                            | The one cross-track contract. **Frozen.**                                      |
| `agents.ts`                                            | Every agent the judge covers, wired or not. The coverage denominator.          |
| `fixtures/records.ts`                                  | Synthetic records, one pair per shape the layers above a runner must handle.   |
| `cli.ts`                                               | Agent selection and `--dry-run`. Plans a sweep; does not run one.              |
| `pricing.ts`                                           | Versioned token rates. Re-derive cost from here; never compare stored dollars. |
| `runners/chat.ts`                                      | Drives one real chat case — one turn or several — and emits one record.        |
| `runners/seedTranscript.ts`                            | Writes a prior transcript through the store path the live turn reads.          |
| `runners/briefingFixture.ts`                           | The briefing a briefing chat case is asked about, and its pinned `today`.      |
| `cases.ts`                                             | Loads and validates one agent's case list.                                     |
| `cases/*.json`                                         | The case lists themselves. One per agent — see below.                          |
| `caseParams.ts`                                        | The placeholder vocabulary, its substitution, and the pre-dispatch guard.      |
| `judgeIdentifiers.ts` / `sweepFixture.ts`              | Resolves the three per-sweep identifiers, and threads them to both arms.       |
| `judgeFixtureIdentity.ts` / `judgeFixtureSeed.ts`      | The dev account the three gp-api readers run as, and the rows that seed it.    |
| `records.ts`                                           | The record store: local directory or S3, behind one narrow interface. Also holds each sweep's per-case rulings. |
| `sweepArm.ts`                                          | Walks a case list for **one** arm. The runner is injected.                     |
| `sweep.eval.test.ts`                                   | Steps 1 and 2: the vitest shell that wires `sweepArm` to the real app.         |
| `sweep.ts`                                             | Step 3: reads both arms, judges, scores, reports.                              |
| `armGap.ts`                                            | The distance between the two captures.                                         |
| `identicalOutputs.ts`                                  | Refuses a sweep whose every pair came back byte-identical.                     |
| `normalize.ts` · `judge.ts` · `score.ts` · `report.ts` | The shared middle.                                                             |

## Marking an agent wired

The report ends with `**Coverage: N of M agents wired (P on placeholder
inputs).**` M is every registry entry except the blocked ones. N counts the
`wired` entries, and **an agent is wired once a live sweep from main has
judged at least one of its pairs.** "From main" means the run was dispatched
from main (its `headBranch` is `main`); the candidate arm is a PR as always. A
case list or a dry run does not count.

To mark one, set it in `WIRED_BY` in `agents.ts` with the evidence: the
sweep's run URL (`https://github.com/thegoodparty/omni/actions/runs/<id>`)
and the run's date (`gh run view <id> --repo thegoodparty/omni --json
createdAt`). The schema refuses a `wired` entry without that evidence, and
evidence on any other entry.

P is how many wired agents were judged on a case list marked `placeholder:
true`, read from the list itself. Those verdicts prove the pipeline reaches
the agent, not that the agent is good, so they stay visible in the number
rather than counted the same as a real bench. The parenthetical is left out
when P is 0. The `--dry-run` plan prints the same counts.

## Case lists: every judgeable agent, and all but one are placeholders

An agent's inputs are one JSON file in `cases/`, named by its registry entry
in `agents.ts` and validated by `cases.ts`. Adding the twenty-second agent is a
file here plus a registry line, and no code.

All twenty judgeable agents have one. All five chat scopes that have a
`ChatScopeHandler` — `chief_of_staff`, `campaign_assistant`,
`ordinance_flow`, `priority_flow`, `briefing_annotation` — and fifteen
background experiments. Nine
of those take plain data: `district_issue_pulse`, `district_issue_snapshot`,
`meeting_briefing`, `meeting_schedule`, `opponent_research`,
`race_opponent_actions`, `race_opponent_collection`, `race_opponent_summary`,
`self_research`. Six need an identifier that has to resolve against a real
organization, and carry placeholders for it instead:
`campaign_tracker_tasks`, `find_existing_ordinances`,
`opportunities_and_challenges`, `opposition_research`, `top_community_issues`,
`trending_issues` — see the next section.

One entry is left: `compliance_setup` carries `cases: null` and is
`blocked`, out of the denominator on purpose — it is the one experiment that
bypasses permission prompts, so a judge arm of it would make real writes
against a real organization. A case list for it would be inputs for a sweep
that must not run.

**All but one are `placeholder: true`.** The exception is
`race_opponent_summary.json`, a real bench of eight probes and a control. Each other background list is
schema-valid against its experiment manifest's `input_schema` and each value
is plausible; each chat list asks a question the seeded fixture org can
actually be asked. But nobody wrote them to test the agent, so a verdict drawn
from any of them is a statement about the pipeline and not about the agent.
That holds for a wired agent too, which is why the coverage line counts the
wired ones on placeholder inputs separately. A case list is not a verdict.

**A chat question has to be answerable against the state the harness seeds,
and the seed is what decides which tools register.** A scope handler
assembles its tool set from its context, so a row left out does not merely
thin an answer — it takes a tool off the model's list. `runners/seedChatOrg.ts`
creates one organization per case, with `positionId` set, plus per scope: a
Pro campaign carrying `details` and a `raceId` (`campaign_assistant`), an
ordinance and an `OrdinanceCodeRecord` placing the agent in Judge City WA
(`ordinance_flow`), a priority (`priority_flow`), a meeting briefing and one
note on it (`briefing_annotation`), or an elected office alone
(`chief_of_staff`). It still seeds no contacts or community issues.

**Briefing chat is opened the way the webapp opens it.** Its conversation is
created with its annotation, in one transaction, by `POST /v1/briefing-chats
{meetingDate, anchor}`, and each turn goes to
`/v1/briefing-chats/:annotationId/messages`. The registry's `POST /v1/chats`
refuses the scope on purpose, so the runner uses the briefing routes rather
than teaching the registry a second way in; the handler that answers is the
same instance the registry holds. Two inputs of that turn cannot come from the
database, and `installBriefingFixture` in `runners/chatSeam.ts` supplies both
for the seeded bucket only, refusing outside a test process:

- **The artifact.** Production reads it from S3 by the bucket and key on the
  `MeetingBriefing` row. The seam serves `runners/briefingFixture.ts` instead:
  the Hendersonville meeting the briefing prompt evals use, as the
  `BriefingSchema` JSON the pipeline writes, so `get_artifacts` and highlights
  work the way they do in production.
- **Today.** The prompt says `Today is <date in the meeting's timezone>`, so
  two arms captured either side of midnight there would read two different
  prompts for one branch. The seam pins it to a fixed day, five days before
  the meeting. It is in the system prompt, so the config digest covers it like
  everything else the agent reads.

Every case in an arm seeds its own office for the one judge user, but the
briefing route finds a briefing by meeting date and the caller's office, which
assumes one office per user. So the briefing seed deletes the earlier cases'
judge briefings on the fixture date first; otherwise a later case would be
routed onto an earlier briefing and continue its conversation. The district,
by contrast, is resolved from the briefing's own organization, which is the
one this case seeded, so `accountState.district` works on briefing chat the
way it does on the other Serve scopes.

`query_constituent_data` and `describe_constituent_data` stay unregistered on
every run this harness makes, but **that is now a deployment gap rather than a
seeding one.** The one gate that lived in our own database — a missing
`organization.positionId`, which `resolveByOrgSlug` refuses on before it asks
anything else — is seeded. The two that remain are not rows anyone could seed:
the position itself lives in election-api, read over HTTP, and the provider
factory returns null without a Databricks credential. Both are absent locally
and in CI, so the pair registers the moment a credentialed deployment drives
this same seed, which `runners/seedChatOrg.tools.integration.test.ts` proves
against the real handler and the real resolver.

A question that needs state nobody seeded produces "I don't have that" on
**both** arms, which is a tie that measures nothing. Each chat list's `note`
says exactly what its scope gets and which cases lean on an absence
deliberately.

**Eight cases each, and `gates.minCases` is 20.** So a corpus verdict over one
of these lists resolves CAN'T SAY however the judge voted — the floor was set
from measured agent non-determinism (three identical Chief of Staff turns gave
6, 4 and 2 tool steps) and eight runs measure that rather than the branch.
Eight is one clean baseline plus seven single-axis variations, which is what
one change can author honestly across twenty agents. **Whether to grow every
list to 20 or to lower the floor is still open.** Do not read the shortfall as
a decision either way.

A background case's `params` is what the dispatch Lambda is called with, and
fourteen of the sixteen manifests set `additionalProperties: false`, so a
wrong key is usually refused before a Fargate task launches — nothing is spent
and nothing runs. The exceptions are `opportunities_and_challenges` and
`opposition_research`, which accept params they do not declare, so on those
two a mistyped key is billed and silently ignored instead.
`backgroundCaseLists.test.ts` pins the flag per agent and checks undeclared
keys for all fifteen either way. That makes validating a list against its
manifest the cheapest check here, and it needs no AWS access:

```bash
uv run --with jsonschema --with referencing python   # Draft7Validator
```

`$ref`s into the meta-schema's `$defs` have to be inlined first, the way
`publish_experiments.py` inlines them for the published manifest —
`district_issue_pulse`'s whole `input_schema` is one such `$ref`, and it
resolves to four required properties rather than none.

A chat case's `question` is one turn (see the next section for the case fields
that go past one), and the questions are not invented from scratch where a
suite already exists. The Chief of Staff golden bench
(`src/chats/general/chief-of-staff/evals/cases`), the Campaign Manager eval
suites (`src/chats/general/campaign-manager/evals`) and the ordinance-flow
evals (`src/chats/general/ordinance-flow/evals`) hold questions that have
already discriminated; the judge uses only a case's question and ignores its
gold value or expectations, so they transplant. Each list's `note` says which
of its questions came from where.

**Win and Serve do not share nouns.** `campaign_assistant` questions say
voters, election, campaign and ballot; the three Serve scopes say
constituents, office and term — `docs/product-vocabulary.md`. The one
exception is labelled in its list: `chief_of_staff/constituent-count` says
"registered voters" on purpose, because whether the agent reframes a Win noun
is itself what the golden bench grades.

People in these files are fictional placeholders in the house style
(`gp-webapp/e2e-tests/tests/app/briefings/briefings.spec.ts` uses
`Test Official`), because this repo is public. States, cities, office titles
and L2 voter file column names are real.

## Four things a chat case can say beyond one question

`ChatCaseSchema` grew four optional fields so a case list can express the
formats a bench is actually written in. **Every one of them is optional and a
list that uses none behaves exactly as before** — the lists in `cases/`
needed no editing for any of this.

| Field             | What it does                                                       |
| ----------------- | ------------------------------------------------------------------ |
| `turns`           | Several USER turns, posted in order to ONE conversation.           |
| `priorTranscript` | A transcript written onto the record before the first driven turn. |
| `toolFailure`     | One named tool, forced to `error` or `timeout`.                    |
| `accountState`    | A closed set of states that gate tool registration.                |

`question` is still valid on its own and is still what every authored list
uses; `turns` is the general spelling of the same thing, and a case must carry
exactly one of the two.

**The case object is `.strict()`, and that is not the same as requiring
anything.** Every field is optional, which is what an older base ref needs.
What strict adds is that a MISSPELLED field name is refused rather than
stripped: a `priorTranscipt` would otherwise be dropped on BOTH arms, the case
would run with no condition applied, and the pair would compare happily and be
reported as a verdict. The nested directives are strict for the same reason and
catch a typo inside one; this is what catches the directive's own name.

**Several user turns, and nothing hand-builds the history.** The runner posts
each turn to the same `conversationId`, so turn two is answered against turn
one and its reply the way `ChatStreamService.run` does it in production — it
appends the user message and replays the conversation's recent rows. `output`
is **every assistant reply, in order and labelled by turn**, not the last one
alone: scoring only the final reply would hide a regression in an earlier turn
behind whatever the agent said last, and hide it asymmetrically, since the
earlier reply still shaped the later one. A one-turn case is unlabelled and
byte-identical to what it was. `trace` is concatenated and renumbered as one
sequence, tool calls and tool errors are counted across the conversation, and
tokens are summed per turn — a conversation is **priced only when every one of
its turns reported**, because pricing the two that did report understates a
total nobody measured. When a turn went unreported the counts are recorded as
zero rather than as that partial sum, which is what a single unreported turn
already recorded and the only other thing `TokenUsageSchema` can say; the trace
carries the reason.

Status is worst-turn-wins, and **a broken turn stops the loop.** The case is
`infraError` because the conversation it authored did not happen, so posting
the turns after it would be real model spend on output nothing reads — they
would be answered against a history whose last reply is missing or is the
interrupted sentinel, and the verdict is already thrown away. A DECLINED turn
is not that: a fallback reply is an agent result, the history is intact, and
the conversation continues. It marks the case `blocked` even if a later turn
recovered, because a conversation that had to recover is the behavior being
compared.

**A seeded prior transcript reaches the store, because no route writes an
assistant message.** The assistant row is produced by the stream as a side
effect of a turn, so there is no HTTP way to put one on the record.
`runners/seedTranscript.ts` therefore writes directly — but every rule it
writes by is borrowed rather than restated:
`ChatStoreService.appendUserMessageIfAlive` for the user row (the same call
`ChatStreamService.run` makes, alive check included), `assistantRowToPersist`
for the decision `persistAssistantText` makes about what an assistant turn
stores, `ChatStoreService.appendMessage` for the write both end in, and
`toJsonPayload` for the conversion a streamed tool call makes on its way to the
same column. A hand-built row would be the wrong shape in ways nobody would
notice, and the model's context would then differ from production while the
verdict claimed to be about the agent we ship.

`persistAssistantText` itself stays **private**. It is the one write in the
chat stack with no ownership check on it, and what a seeder needs is the rules,
not the ability to put an assistant row into an arbitrary conversation — so
only the rules were lifted out, and the seeder makes the ownership check once
before it writes anything.

What reaches the model is narrower than it looks: `toLlmMessages` replays a
history row's `role` and `content` and **nothing else**. Segments are not
replayed, so a seeded tool call changes what the client would render and what a
reader of the record sees, not the model's context. Nor can a seeded turn carry
a tool _result_ — production streams the result to the client and persists only
the call. What DOES change the model's context is a leading ASSISTANT row,
which `toLlmMessages` folds into the system prompt rather than sending as an
invalid leading turn.

**So a transcript has to be one a conversation could have produced, and the
schema enforces it: it opens on a user turn and never puts two assistant rows
together.** The fold takes only the FIRST leading assistant row, so either
shape leaves an assistant row where the provider requires a user one, and that
arrives as a stream error after the conversation is open and a turn has been
attempted — the spend everything else here refuses before. `campaign_assistant`
is what makes this load-bearing rather than theoretical: its `seedConversation`
writes a scripted opener before the seeder runs, so with the rule that opener
is the row that gets folded and the seeded transcript follows it legally.
Without it, an author's leading assistant row is the second one and the turn
dies. The fold is also a reason not to want one: it is injected as "You already
greeted the candidate with: …", which is a greeting claim rather than a reply,
and on a Serve scope calls an elected official a candidate.

**`anchor` is not a substitute for a transcript, and it is worth knowing which
you need.** `POST /v1/chats` stores the anchor on the conversation and the
scope's `loadContext` reads it back, so an anchor attaches the conversation to
an existing domain resource — an ordinance at a step, a priority, a community
issue — and that context reaches the system prompt and the tool set. It puts no
prior messages on the record. So a case that needs "the agent is working on an
existing ordinance at the draft step" needs an anchor (and
`accountState.ordinanceStep`), not a synthetic transcript; only a case that
needs the agent to have already SAID something needs `priorTranscript`. The one
scope that seeds a message of its own is `campaign_assistant`, whose
`seedConversation` writes a scripted opener.

**A forced failure is honoured at the seam that already wrapped every tool.**
`instrumentTools` called the real `execute` and recorded the outcome; a
directive replaces that call and pushes the same outcome a genuine failure
pushes. The real tool is NOT run — an ordinance `present_*` tool commits its
own record, and a case that says the tool failed must not leave that write
behind. `timeout` reproduces the OUTCOME of a timeout (a tool step that
rejected, which the AI SDK turns into a tool-error result while the loop
answers with less information) rather than a real wall-clock hang: a hang would
cost the route's whole 300s stream timeout per case and arrive as an infraError
with no answer to compare.

\*\*The mark covers a seeded transcript and not the other two conditions, which
is a judgement rather than an omission. A forced tool failure already separates
itself more strongly than a report line could: `isComparable()` is false for
it on a chat run, so the pair never reaches a delta at all. And an account state is a state
production really produces — a campaign without Pro, an organization without a
position — seeded through the same rows the app writes, so a verdict under one
is a verdict about a real account. Only the transcript is a context the harness
authored and production would not have built.

One consequence to read before authoring these:\*\* `isComparable()` is false
for any chat run that hit a tool error, so a forced-failure pair resolves CAN'T SAY
rather than entering the delta. Telling an injected failure from an incidental
one needs a field `record.ts` does not have, and `record.ts` is the frozen
cross-track contract — so that is a change to review, not a drive-by. Until
then a forced-failure case buys the two arms' stored answers and traces side by
side, not a scored delta.

**An account state is a closed set, and the set is read off the handlers.**
Tool registration is the only thing about an account the model can see, so the
states worth naming are the ones that gate it: `pro` (campaignManager gates the
whole CRM and voter-file family on `ctx.isPro !== false`), `district`
(`organization.positionId`, the half of the district gate that lives in our own
database), `campaignDetails` (the blob carrying `raceId`, which
`get_ballot_requirements` registers on) and `ordinanceStep` (each step past
clarify carries its own `present_*` tools). `briefingHighlight` is the one
that gates no tool: like `ordinanceStep` it picks what the conversation is
anchored on, here a highlighted passage instead of the whole briefing, which
the briefing prompt renders differently. `.strict()` keeps it closed: an
open bag of column overrides would let a case list seed a state no deployment
can produce, and the verdict would be about an agent we do not ship.

`district` is the one whose effect cannot be measured here. It gates only the
constituent-data pair, and the provider factory returns null without a
Databricks credential — so the pair is unregistered locally and in CI whatever
`positionId` says, and the digest is identical either way. The same deployment
gap the case-list notes already record. What is ours is the row, and the runner
asserts it.

**Every refusal happens before a turn is driven.** A chat turn costs real
money, so: the schema refuses an undefined state or an unimplemented failure
mode at case-list load; `seedOptionsFor` refuses a state the scope has no row
for before anything is seeded; `assertTranscriptFits` refuses a transcript the
route's 40-message replay window would drop; and `assertSeededAccountState`
reads the three rows back and refuses a state the seed does not match, because
the state is seeded by the runner's CALLER and a caller that forgot would
produce a record claiming a condition the agent was never under.

The one check that cannot be static is the forced-failure tool name: the tool
set is assembled by the scope handler from its context, so no list here could
be right for every seed. It is checked at the LLM seam, against the names the
turn actually offered — still before the model is called, so a refused
directive costs nothing. It is both **thrown** (which is what keeps the model
from being called) and **recorded on the capture** (which is what lets the
runner name it): the chat route catches a throw out of `streamChatCompletion`
and writes an error chunk, so on the throw alone the run would come back as an
ordinary infraError and the unhonourable directive would be invisible.

**Adding one of these fields to an EXISTING list is the one operational
catch.** A `turns`-shaped case fails an older base ref's schema outright, and
`loadCaseList` throws inside `captureArm`'s per-agent try — so that arm skips
the WHOLE agent, not just the case, and the candidate arm's already-paid
records for its other cases have nothing to pair against. It fails loud, and
the reason reaches the report. But it means `question` plus a new field is the
gentler way to extend a list until the base ref carries this change, and a
fresh list for a new bench is gentler still.

**A seeded case is marked all the way to the report**, the road
`placeholderCases` already travels: the case list, then
`ArmAgent.seededTranscriptCases` in the arm manifest, then
`SweepReport.seededTranscripts`, then one line in the rendered report. The
record carries it too, inside `input.value.seededTranscript`. The manifest
field is **optional**, which is why `MANIFEST_SCHEMA_VERSION` did not move for
it: the base arm writes its manifest with the base ref's copy of `records.ts`,
and a required field would read as a corrupt manifest rather than as version
skew. `sweep.ts` unions the mark across both arms for the same reason — an arm
whose ref predates the field records nothing at all.

**Nothing here needs a version marker, and the reason is the input payload.**
A case using none of the new fields records
`{ kind: 'question', value: <the question> }`, byte-identical to before. A case
using ANY of them records `{ kind: 'transcript', value: { turns, ... } }`. So
if an older base ref parsed the same list with an older schema, stripped the
field it does not know and drove a plainer run, the two arms' inputs no longer
match and `MismatchedInputError` refuses the pair — rather than comparing two
different conditions and reporting the difference as a verdict about the
branch. A case carrying only `turns` fails the older ref's schema outright,
which surfaces as a named skip in that arm's manifest. Both are loud.

## A background case can ask its own questions

Every pair is judged on `config.dimensions`, which ask whether an artifact is
good. A probe asks something narrower: whether the artifact handled the one
thing the case mutated. A polished artifact that glossed over a sparse input
can win every default dimension against one that handled it. So a background
case may carry up to four `dimensions` of its own:

```json
{
  "caseId": "sparse_opponent",
  "params": { "...": "..." },
  "dimensions": [
    {
      "name": "sparse_input_handling",
      "question": "Does the summary say which opponents had too little source material, rather than padding them?"
    }
  ]
}
```

- **Judge-only.** The runner never reads the field, so it never reaches the
  agent's params or a record. Step 3 reads it from its own checkout's case
  list, keyed by caseId, and puts it on the payload both slots share. A base
  ref that predates the field strips it from a case it only runs, so an older
  base cannot turn it into a mismatched input.
- **Asked beside the defaults, never instead of them.** The panel's schema
  requires an answer for each one, with its question printed in the rubric. A
  case with none sends the same prompt bytes it always did.
- **Scored on its own row.** Each name is aggregated over the cases that ask
  it and nowhere else: it is never part of a default dimension, `overall`,
  the regressions line or the label. The row names the cases that asked it,
  and below `gates.minCases` it prints no interval, because one case
  resampled is one number.
- **One name, one question.** A list that asks a name two different
  questions is refused, since the row would average two answers. The names
  `overall` and the default dimensions are refused too.

## Two things a background case can say beyond its params

Both are for the judging step. The runner dispatches `params` and nothing else,
so the agent never sees either one.

```json
{ "caseId": "t7-stale", "params": {}, "condition": "Source 2 is an archived page from the previous cycle." }
{ "caseId": "control", "params": {}, "scored": false }
```

- **`condition`** says what the case planted in or took out of `params`. It
  is added to the judge's shared input as a last line, `Condition: ...`, the
  same way a chat case's `toolFailure` is. The background rubric tells the
  judge to decide first whether each run handled the condition. A run that
  reads better but ignores the condition counts as worse. Up to
  2,000 characters, trimmed, never empty.
- **`scored: false`** makes the case a control. It runs and is judged like
  any other case, but it is kept out of the verdict and everything it is
  built from: overall, dimensions, case-dimension rows, gates, floor, flags, exclusion counts,
  measured evidence and the identical-output check. The report prints it
  under **Controls (not scored)**. Its records still count toward the two
  checks that read every record whether or not it was judged: the unpinned
  mart warning and invariant violations. A rule a control's output broke is
  still a rule the branch broke. On an
  input built to show no difference, that line shows how often and how
  strongly the judge calls a difference anyway. Read every other verdict in
  the section against it. A control still runs, so the plan still prices it,
  and it does not count toward `gates.minCases`.

**A control needs both refs to agree.** The candidate's list belongs to the
branch under test. On its own, it could mark the probe it regresses
`scored: false` and turn the verdict green. So a case is held out only when
the base ref's copy of the list, read from the base worktree that judge.yml
passes as `JUDGE_BASE_DIR`, holds it out too. In two situations the case is
scored anyway, and the report names it on one fixed line:

- the refs disagree
- the base copy cannot be read, which includes a local run with no
  `JUDGE_BASE_DIR`

The safe mistake is to count a control, never to drop a probe. So a new
control takes effect only from the sweep after the PR that adds it merges.

**Both fields are read from case lists, not from records.** Step 3 runs in
the candidate's tree (`WORKSPACE`), so it reads the condition from its own
copy of the list. Neither field is written into a record, for two reasons:

- A field written there would have to match on both arms, and a base ref that
  predates it would strip it from one side. `blindCase` would then see two
  different inputs and refuse every pair.
- Read once and added after blinding, the condition is one string, so it is
  identical across arms by construction.

If step 3 cannot read the list, it refuses that agent by name instead of
judging without it. Otherwise it would score a control as an ordinary case,
judge a probe without its condition, and the report would mention neither.

`BackgroundCaseSchema` is `.strict()` for the same reason `ChatCaseSchema` is:
if a misspelled `scored` were stripped, the control would be scored silently.

`race_opponent_summary.json` marks Melecia's `control` as `scored: false`.
None of her probes has a `condition` yet. Those strings are hers to write.

## Six background agents need identifiers a case list cannot carry

Nine of the fifteen authored background lists carry plain data. Six do not:
`campaign_tracker_tasks`, `opportunities_and_challenges` and
`opposition_research` require a `race_id`; `find_existing_ordinances`,
`top_community_issues` and `trending_issues` require an `organization_slug`;
the two research agents also require a `user_email`.

A case list carries a token and the sweep carries the value:
`{judgeOrgSlug}`, `{judgeRaceId}`, `{judgeUserEmail}`. One step in the sweep
job, before either arm, runs `judgeIdentifiers.ts` to make them: a `judge-`
slug from the sweep id, the BallotReady race id of `JUDGE_FIXTURE_RACE` from
gp-api's public races route, and the reserved `judge-sweep@example.com`.
`caseParams.ts` substitutes them at dispatch time, recursively, because
`user_email` also has to land inside `campaign_strategy_context.candidates[]`
for `is_user` to match. No credential is involved. A resolution that fails
does not fail the sweep: `fixtureValues` is `{}`, and each background agent is
refused by name on both arms before anything is staged, except the
`readsGpApi` ones, which run as `judge-fixture` and need none of the three
unless their cases name a race or an email.

**For most agents, none of the three names anything that has to exist.** The
dispatch pins the organization slug to `judge-*` (`JUDGE_ORG_SLUG_PREFIX`) so a
run cannot overwrite a real organization's `latest.json`, and the slug in
params is echoed into the artifact and scopes nothing. `race_id` is a trace
and idempotency identifier in all three manifests, and `user_email` is matched
only against the roster inside the same params object. They still come from
the sweep rather than the case list for two reasons: a field documented as a
BallotReady brHashId should carry one, and a public case list should carry no
address. The three agents in the next section are the exception.

**Both arms get the same values, and that is the whole point.** The two arms
are two processes in two worktrees, so the identifiers travel exactly the way
`JUDGE_DATA_VERSION` does: resolved once outside the arms, exported into each
one's environment, read back through `parseArmEnv`. A variable nobody set
arrives from Actions as an **empty string, not as an absent one**, and reads
here as "not supplied", for a hard reason: `''` would substitute cleanly and
dispatch a params object the agent's own `minLength` refuses.

**An unsubstituted token fails before the first dispatch, and nothing further
down would catch it.** `substituteBackgroundCases` checks the WHOLE list and
returns none of it if any case is short a value, and `buildDispatchMessage`
refuses one as a backstop. There is no third line of defence: every one of
these params is a plain string with at most `minLength: 1` — no pattern, no
format — so a literal `{judgeOrgSlug}` is fifteen valid characters. The
manifest passes it, the message is accepted, a task launches, and the run is
spent against an input nobody meant. The artifacts come back as errors or
inventions, they come back _identical_, and the verdict looks like a real
comparison.

## Three agents read gp-api, and run as a seeded dev account

`meeting_briefing` reads the official's priorities and community issues, and
`top_community_issues` and `trending_issues` read the issue feed
(`GET_community_issues`). The broker reaches gp-api as the run ticket's user,
so a dispatch that names no user gets nothing back and the agent takes its
empty-data fallback on both arms.

These three are marked `readsGpApi` in `agents.ts`, and only they run as the
fixture account in `judgeFixtureIdentity.ts`: the dispatch carries
`clerk_user_id: user_judge_fixture` and the slug `judge-fixture` instead of
the per-sweep one, and `{judgeOrgSlug}` in their params resolves to the same
slug. Every other background dispatch is unchanged and names no user.
`buildDispatchMessage` refuses any other user, and the fixture user on any
other slug.

**One-time setup.** The account has to exist in the dev database, which is
the one the broker's gp-api reads. Seed it from `packages/gp-api`, with
`DATABASE_URL` set to the dev cluster's real writer endpoint
(`gp-api-db.cluster-<hash>.us-west-2.rds.amazonaws.com`):

```bash
DATABASE_URL='<dev cluster writer url>' \
  npx tsx scripts/seed-judge-fixture.ts --confirm-dev
```

It prints the target host (never the password) and refuses every other host:
prod, the `cluster-ro-` reader, other clusters, and localhost or an IP, since
a tunnel can point anywhere and there is no way to confirm one. A second
run writes nothing. The rows are `judgeFixtureSeed.ts`: a user, its
organization, an elected office, four priorities and three issues on each
list. There is **no campaign and no website**, so the write tools a broker
token can reach (website edits, domain purchase, Peerly submission) 404
against it, and the seed refuses an organization that has gained a campaign.
`judgeFixtureSeed.db.test.ts` pins the other half: every office-scoped
`@McpTool` is a GET, and every tool that writes needs a campaign.

The feed is office-agnostic on purpose: each case names a different real place
in its own params, and every case reads the same rows on both arms.

## Two refusals, and they are not the same one

**Identical config.** Both arms hashed to the same `configDigest`, so the agent
could not have seen a difference. `normalize.ts` throws; `sweep.ts` turns it
into a refusal. This catches identical _input_.

**Identical output.** Every judgeable pair came back byte-identical even though
the digests differ, so nothing downstream used the difference — a candidate
override that rode along unread, a staging step that dropped a field. This
catches identical _output_, which is the later and stronger signal, and it
fires before any judge call. Configurable via
`gates.failOnAllIdenticalOutputs`, defaulting to refusing: a false alarm on a
genuinely inert change costs a re-read, and a false SAME costs a wrong
decision. The per-pair count is reported either way, because a few matching
pairs are ordinary and the count is what makes a dropped candidate obvious.

**Both of them are a money guard, so a request that named its agents gets a
qualifier instead.** What they exist to stop is an accidental sweep — `auto`
picking an agent up because a README in its directory moved — and not a
deliberate one. `configDigest` is `sha256(renderedSystemPrompt +
sortedToolNames)`, so a branch that changes only the model, the provider, the
sampling settings or the code behind a tool whose name did not move hashes
identically on both arms, and evaluating a model swap is one of the most
obvious reasons to reach for this harness. Identical outputs everywhere have a
legitimate reading too: the change may genuinely do nothing, which is a real
SAME. So when `JUDGE_SELECTION` is `explicit` both become loud blocks in the
report (`identicalConfigLines`, `identicalOutputsReportedLines`), saying what
the digest covers and therefore what a matching digest does not rule out. On
`auto` nothing changes. The write check is upstream: judge-comment.yml admits
only `admin|maintain|write` and denies on a failed lookup, so a request that
names its agents already comes from someone who can push.

**The digest is deliberately NOT widened to include the model.** It is the key
the background runner's base-arm cache is built on (`baseArmCacheKey`), so
redefining it invalidates every cached base arm, and it is a field on the
frozen `record.ts` contract that other branches read.

## A panel that loses a seat says so

`judgeCase` runs every seat in `panel.seats` and collects the ones that threw
instead of abandoning the verdicts it already paid for. A panel reduced to its
survivors still returns a comparison, and that comparison reads identically to
one the whole panel agreed on — so `score.ts` aggregates the losses onto
`AgentScore.degradedPanel` and `report.ts` prints one line per agent naming how
many judgments ran short and which seats were lost. `null` when the panel was
whole, and the report prints nothing at all in that case; a warning that always
appears is a warning readers learn to skip.

It cannot fire on today's single-seat default, where one failing seat leaves no
seats and the judgment comes back `ungraded` instead. It starts mattering the
moment the second seat `config.ts` anticipates is added. Read the
panel-disagreement rate for a listed agent as a floor: fewer opinions agree
with each other more easily.

## Records outlive the run

A CI sweep keeps its records at
`_judge/<sweepId>/records/<arm>/<agentId>/<caseId>-<attempt>.json` on the
private `gp-agent-artifacts-dev` bucket, so a rubric change can re-grade them
at no agent cost. The judge role's `KeepJudgeRecords` grant covers `_judge/`
on that bucket and nothing else, and no real run's key can start with it.
The sweep id carries the run id and attempt, so no two sweeps share a key.

If the job could not assume the role, the step that picks the store falls
back to a job-local directory and warns: a chat-only sweep still runs, and its
records die with the job. Records are never uploaded as an Actions artifact,
because omni is public and a record carries the agent's whole answer and every
SQL statement it ran against the constituent tables.

**Per-case rulings live there too.** After judging an agent, step 3 writes
every judgment the panel made to `_judge/<sweepId>/rulings/<agentId>.json`:
each case, attempt and order, with every dimension's verdict, magnitude and
reasoning, the overall, the floor, the flags, and the slot map that says which
arm X was. That is what lets a bench be read probe by probe rather than only
as one delta. A ruling quotes the agent's output, so it never goes in the
report; the report prints only where each agent's rulings went (a file path,
or an `s3://` URL), and says so if the write failed. The verdict does not
depend on the write. A second judging
run over the same sweep id overwrites the file, so it holds the latest
grading.

**Flags come from a closed list**, the rubric doc's (`FLAG_TYPES` in
`judge.ts`): `restricted_data`, `unrequested_action`, `fabricated_source`,
`instruction_injection`, `consequential_misstatement`, `partisan_steering`,
`other_severe`. The prompt and the schema the model fills both name them. A
free-text type let one finding arrive under two names, so flag counts did not
compare run to run, and the type is printed in the public report. A type off
the list is replaced with `other_severe` rather than failing the seat. Changing
the list is a rubric change: edit the doc and `FLAG_TYPES` together and bump
`RUBRIC_VERSION`.

**The schema the panel is sent has to fit the structured-output API's
limits**: at most 24 optional parameters and 16 union parameters (a nullable
field is one) across the whole schema, and a compiled grammar under a size
the API does not publish. Over any of them and the API refuses every panel
call. The dimension object repeats once per dimension, so on the wire it holds
only required scalars: `none` and the empty string stand for an absent
magnitude or `needed_to_decide`, and the evidence is one list beside the
dimensions, each item naming the dimension it supports (an evidence list
inside each dimension compiled too large at two case dimensions). The
schema's transform turns the reply back into a `CaseVerdict`, so stored
rulings and everything downstream keep the old shape. Tests in
`judge.test.ts` count the first two limits on the schema the AI SDK actually
sends, at the most dimensions a case may add, and hold every dimension to
scalars for the third, which only a live call can measure.

**A judge that answers no pair fails the sweep.** When every judgment for an
agent comes back ungraded, the agent is reported as refused with the
deduplicated reasons, and the judging step exits non-zero even if other agents
scored. Scored instead, it read as CAN'T SAY over zero cases and went green.

## If you are building a track

**Build against the fixtures, not against a runner.** The normalizer, the
judge, the scoring and the report are each a pure function over a record, so
every one of them can be written and fully tested before any agent runs. That
is what lets the tracks run in parallel.

```ts
import { CHAT_PAIR, TOOL_ERROR_PAIR } from './fixtures/records'
```

The pairs exist to cover the cases that are easy to forget:

- `CHAT_PAIR` — the ordinary comparison.
- `VOTER_QUERY_PAIR` — carries generated SQL and a pinned Delta version.
- `BACKGROUND_PAIR` — an opaque artifact output, same schema, no special case.
- `TOOL_ERROR_PAIR` — the candidate's tool failed but it still answered.
- `BLOCKED_PAIR` — the agent declined. Still an agent result, still judged.
- `INFRA_ERROR_PAIR` — the only case with a null output.
- `IDENTICAL_DIGEST_PAIR` — both arms saw the same config; refuse to run.

**`record.ts` is frozen.** If your track needs a field no fixture carries,
that is a change to the contract and it goes through review. Two tracks
inventing the same field differently is the failure this structure exists to
prevent.

**Never call a real agent.** No track in this build spends money; real runs
come after the merge. `RUN_LLM_EVALS=1` is not for this code.

That is enforced, not just asked for. A run with no `script` would be
answered by the real, paid model, and a forgotten field type-checks cleanly —
so the paid path takes two deliberate acts: `realModel: true` on the request
**and** `JUDGE_SPEND=1` in the process. Omit either and the run throws before
anything is patched.

## Cost is re-derived, never compared as stored

A record carries raw token counts, the model and a `pricingVersion`, plus
`cost.usdAtCapture`, which is only a snapshot.

`cost` is **optional**. It is absent when nobody could price the run — an
unpriced model, or cache tokens with no rate. Absent rather than zero,
because a stored 0 under a real `pricingVersion` reads as "this run was
free" and `sharesPricing()` would call two arms comparably priced when one
was never priced at all. And absent rather than fatal: cost is measured
evidence, measured evidence never gates a verdict, so an unpriceable run
keeps its status and its answer and loses only its cost line. This is a live
path, not a hypothetical — every chat scope declares a `claude-opus-4-7`
fallback that `pricing.ts` has no rates for.

**Compare with `priceUsd()` from `pricing.ts`. Do not compare
`usdAtCapture` between two records.** A cached base arm can predate its
candidate by months, so comparing two stored figures measures Anthropic's
price list as much as it measures the branch. Re-deriving means a price
change re-prices all of history for free, the same way a rubric change
re-grades stored records without re-running an agent.

Tokens are split by how they are billed, including `cacheRead` and
`cacheWrite`. Both are zero in every record today because prompt caching is
not enabled, which is exactly why the fields exist now. `priceUsd` throws
rather than pricing a cache read at the full input rate, because doing so
overstates it by roughly ten times and would silently invalidate every
stored comparison. Switching caching on therefore fails loudly and needs
rates added to `pricing.ts`.

A background record's counts come from the `type: result` line of the run's
`conversation.jsonl`, under `usage`: `input_tokens`, `output_tokens`,
`cache_read_input_tokens`, `cache_creation_input_tokens` (written by
`_usage_counts` in `packages/gp-ai/pmf_engine/runner/harness/claude_sdk.py`).
The harness prices its turns in-process, so before those were logged the only
token-derived figure on the line was a dollar amount and `priceUsd()` over a
background record re-derived 0 on both arms.

**An unobserved count is absent, never zero.** The harness logs only the
counts the SDK actually reported: a `ResultMessage` with no usage object
produces a line with no `usage` key at all, and a single garbled field drops
that one key rather than writing it as 0. A reported zero is an observation
and does reach the line, which is what the cache-read guard above needs. So a
`usage` missing a key is a record to reject, not a record to price — zero is
legal to `priceUsd` and would turn a $4 run into $0.00 beside a verdict.

Every result line carries `usage_schema: 1`. A sweep's two arms are two
checkouts at two commits, so a base arm predating the counts writes a line
with no `usage` key for a reason that has nothing to do with the run. The
stamp is how a normalizer tells "this harness did not log counts" from "this
run's counts were not observed".

**Follow-up, not done here: `TokenUsageSchema` cannot express "unknown".** Its
four fields are non-optional ints, so a normalizer reading a partial or absent
`usage` has no way to record that the count is unknown — its only options are
to reject the record or to invent a zero. Until that is resolved, a
cross-commit sweep whose base arm predates the counts would report the
candidate's entire spend as a cost regression against a $0 base. `record.ts`
is the frozen cross-track contract with other branches in flight against it,
so the change goes through review rather than a drive-by.

An unknown model throws too. The cost delta is printed beside a verdict as
evidence, and a guessed or zero rate makes that evidence fiction.

The same rule now holds on the harness side. `_price_turn` returns `None` for
a model absent from `_PRICE_PER_MTOK`, and `get_accumulated_cost()` withholds
the whole running total once any part of it went unobserved, so a
**timed-out** run reports no cost instead of $0.00 — the accumulator is
precisely the figure the expensive failure is billed at. `main.py`'s
`_accumulated_agent_cost` already omitted `cost_usd` from the failed envelope
on `None`, so a reported 0.0 means genuinely zero and an absent figure means
unknown.

There are two doors onto that defect and the accumulator holds a reason for
each. A turn on an unlisted model is one. The other is a terminal
`ResultMessage` whose `total_cost_usd` is absent, which the SDK allows: the
authoritative figure then supersedes nothing, so it neither overwrites the
per-turn estimate nor forgives an unpriced turn inside it. Only a
`ResultMessage` that actually carries a cost does both.

**Follow-up, not done here: the caveat only reaches a log.** Nothing between
the envelope and a report says _why_ a run has no cost — the reason lives only
in the harness WARNING. A reader of the run row sees a blank, which is honest
but not diagnosable. And `pricing.ts` still has no Opus rates; adding them
needs the published figures rather than a plausible guess, which is the one
thing that file exists to prevent.

## Where a record came from

`ci` carries the repo, PR number, workflow run id and URL, so a stored
record leads back to the change it judged rather than to a bare commit hash.
It is absent on a local run.

`ci.workflowRunId` is not the record's `runId`. That one is the agent run,
this one the Actions run. They are named apart on purpose.

## Two rules that are easy to get wrong

**For a chat agent, a tool failure is never a quality signal.** The
Databricks client resolves lazily, so a broken credential does not fail a run —
the agent answers with less information instead. Both arms degrade
identically, and a judge shown two degraded outputs will confidently report a
code regression. Use `isComparable()`; any chat case where either arm hit a
tool error resolves to CAN'T SAY and leaves the delta.

**For a background agent, a tool error does not exclude the pair.** What the
judge scores is the final artifact. Live sweeps showed background agents
routinely writing a Python snippet in Bash, hitting `exit code 1` or a
`ValueError`, fixing it and carrying on: run 37355882821 excluded 7 of 9
`race_opponent_summary` pairs for `Bash — exit code 1`, and run 37352629792
excluded all but one pair across the three gp-api agents. So `isComparable()`
is true for a background record with tool errors, and its pair is judged. A
background pair is still excluded for `infraError` (which is also how the
runner records a missing or unparseable artifact, or a trace it could not
read) and for an identical config, exactly as before. The base-arm cache does
NOT follow this rule: `isCacheableBase()` caches a background base arm only
when it is comparable and has zero tool errors, so a base arm captured during a
credential or broker outage is scored that sweep but never becomes the cached
baseline. The tool-error count is still measured
(`tool errors: +X per run pair`) and its causes still listed, so the evidence
stays beside the verdict.

Each record names its failures in `toolErrorDetails`: the tool and its error
text, for the first 10 failing calls, each cut to 300 characters (head and
tail, so a traceback keeps the exception that ends it). Both runners fill it.
The text is redacted on the way in (`toolErrorDetails.ts`: the arm's secrets
by value, then keys, tokens, URLs, internal hosts, IPs, emails, phones, SSNs,
ids and long digit runs by shape), but redaction cannot recognise a name or an
address, so **the text never reaches a public page**. It stays in the record,
which lives on the runner and in the private bucket.

The report, which is public (run log, step summary), prints only a tool name
and an error class, and both are allowlists, not patterns, because a pattern
lets a name through whenever it has the right shape (`MariaGonzalezError`,
`JOHN_SMITH_ERROR`).

- **Tool name** (`publicToolName`): for a background agent, a harness
  built-in (Bash, Read, WebSearch, Agent, ...) or a broker MCP tool on
  `KNOWN_BROKER_TOOLS` (e.g. `mcp__broker__GET_community_issues`). It is a
  list of names, not a pattern, because a model can invent a well-shaped
  `mcp__broker__GET_jane_doe_voter_record`. For chat, a tool gp-api
  registered, which the runner checks before it writes. Anything else is
  `unknown`, and both runners store it that way.

  **Adding an @McpTool route?** `knownBrokerTools.db.test.ts` fails until
  `KNOWN_BROKER_TOOLS` in `toolErrorDetails.ts` matches the tools gp-api
  serves. Add `mcp__broker__` plus the name `deriveToolName` gives the route
  (the test's failure diff prints it), and remove one you deleted.

- **Error class** (`errorClass`): a known exception type (`KeyError`,
  `JSONDecodeError`, `HTTPStatusError`, ...), a known Databricks code
  (`PARSE_SYNTAX_ERROR`, `TABLE_OR_VIEW_NOT_FOUND`, ...), `HTTP 503`,
  `timeout` or `exit code N`. An unlisted exception prints as `other
exception`, an unlisted code as `other error code`, and the rest as
  `other`. To name a new one, add it to the list in `toolErrorDetails.ts`.

Causes are grouped by tool and class under the "Excluded pairs" line, with the
pair count and the arms hit. That list covers every pair excluded for a tool
error (only a chat pair is) and every pair excluded as identical config whose
arms hit a tool error anyway, so a background pair that moved from one reason
to the other still shows what failed. For a background agent, the causes on
pairs the judge actually graded come after it under **Tool errors (scored, not
excluded):**. A pair whose judge call failed is ungraded and is not listed
there. The two lists never mix, so a reader cannot take a scored pair for an
excluded one. A record written before the field existed shows
as `unknown`, `unrecorded`. Anything new that renders a tool error publicly must
go through `errorClass` and `publicToolName`, never the record's text.

**A refusal is a result, not a failure.** `blocked` keeps its output and stays
judgeable, because whether declining was correct is exactly what a verdict
should capture. Only `infraError` has no output.

**`record.toolQueries` is always empty for a background agent.** Not a bug, and
not worth debugging when you see it. A background agent reaches the warehouse
by curling the broker from Bash, so its SQL is buried inside a shell command
string rather than in a structured `sql` tool argument, and only a structured
one is collected — regexing SQL back out of a shell string would put something
that is not the agent's verbatim query into a field whose entire value is being
verbatim. The chat agents, which call a real SQL tool, do populate it.

## Verify

```bash
npx vitest run src/chats/evals            # from packages/gp-api
npm run verify -w packages/gp-api         # what CI runs, unfiltered

# Both entry points AS COMMANDS, which is the only way to catch a missing
# entry point. The judging entry exits 1 and names the missing variable.
npx tsx src/chats/evals/judge/cli.ts --agents=all --dry-run
npx tsx src/chats/evals/judge/sweep.ts
```

Invoke them rather than importing `run()` or `main()` when you want to know
the command works. A wrapper that imports the function and logs the result
proves the function: an earlier version of `cli.ts` exported `run` and never
called it, so the command printed nothing and exited 0, and a test built that
way could not have noticed. `sweep.test.ts` spawns `npx tsx sweep.ts` for
exactly this reason.

Run the typecheck, not just the tests: vitest uses SWC and does not
typecheck, so a tsc-only error passes the suite and fails CI.
