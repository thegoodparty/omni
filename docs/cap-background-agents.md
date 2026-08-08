# CAP — background agents (the PMF Engine)

The background half of CAP runs an AI agent unattended, in a network-quarantined
sandbox, for one org, and produces a validated JSON **artifact**. This doc traces it
end to end: dispatch (gp-api) → run (`gp-ai-projects`) → reconcile (gp-api) → consume
(products) → eval (`packages/runbooks`).

Read the overview first: [`cap.md`](cap.md). For the gp-api transport layer in more
local detail, `packages/gp-api/src/agentExperiments/AGENTS.md`; for the runtime,
`gp-ai-projects/pmf_engine/control_plane/README.md` and
`gp-ai-projects/broker/ARCHITECTURE.md`.

## The run lifecycle, end to end

```
 gp-api                          gp-ai-projects (external repo)                 gp-api
 ──────                          ──────────────────────────────                ──────
 product module
   │ dispatchRun()
   ▼
 ExperimentRun(QUEUED) ──SQS──▶ dispatch Lambda ──▶ DynamoDB job queue
   agent-dispatch-{env}.fifo    (validate vs           (agent-job-queue-{env})
                                 S3 manifest)                 │ stream / 1-min tick
                                                              ▼
                                                       scheduler Lambda
                                                       (reserved concurrency 1;
                                                        sole RunTask caller;
                                                        cap = SSM param)
                                                              │ RunTask
                       ◀── "started" result SQS ─────────────┤
 markStarted → RUNNING                                        ▼
                                                       Fargate runner
                                                       (Claude Agent SDK loop)
                                                              │ every external call
                                                              ▼
                                                          broker (FastAPI/ECS)
                                                              │ validate artifact
                                                              │ upload to S3
                       ◀── "success" result SQS ─────────────┤  gp-agent-artifacts-{env}
 fetch artifact from S3,                                      ▼
 classify, store key,            (on task crash w/ non-zero exit:
 fan out to products              ECS task-reaper Lambda sends "failed")
```

Status on the gp-api `ExperimentRun` row:
`QUEUED → RUNNING → COMPLETED | FAILED | AWAITING_RESUME`.

## Part 1 — gp-api: dispatch and reconcile

gp-api's `src/agentExperiments` module is the transport layer for the PMF Engine
contract. It is intentionally **thin and domain-agnostic**: it moves runs through
states and knows nothing about which experiments exist or what their artifacts mean.
Product modules own params and artifact handling.

### Dispatch

`ExperimentRunsService.dispatchRun(...)`
(`src/agentExperiments/services/experimentRuns.service.ts`) is the single entry
point. There is **no controller in this module** — the HTTP surface belongs to the
product callers. `createAndEnqueueRun`:

1. Resolves the SQS queue URL from `AGENT_DISPATCH_QUEUE_NAME` (unset in preview
   envs → dispatch is a logged no-op).
2. Skips dispatch for test campaigns (`isTestCampaign` on the owner's email).
3. Inserts an `ExperimentRun` row with `status = QUEUED`, a `uuidv7()` `runId`,
   `priority`, `params`.
4. Sends the SQS message. On send failure it flips the row to `FAILED` and throws
   `BadGatewayException`.

The dispatch message (what gp-api actually sends today):

```js
{
  run_id,
  params, // includes `_input_files` under a reserved key when there are uploads
  organization_slug,
  experiment_type,
  clerk_user_id,
  priority, // 'HIGH' | 'DEFAULT'
}
```

`MessageGroupId = "agent-dispatch-{organizationSlug}"` (per-org FIFO ordering).

> **Doc correction:** the envelope documented in older copies of
> `agentExperiments/AGENTS.md` omits `clerk_user_id` and `priority`, which the code
> does send. There is no top-level `prior_artifact_versions` or `input_files` field on
> the gp-api side — uploads ride inside `params._input_files`.

`dispatchRun` is generic over `keyof AgentJobContracts`, and `params` is typed
against `src/generated/agent-job-contracts.ts` — **generated from the per-experiment
`manifest.json` files** in the `agent-experiment-metadata-dev` S3 bucket via
`tsx scripts/generate-agent-job-types.ts`. The `experimentType` DB column is just a
`String`; the typing is a compile-time guard, not a DB constraint.

### Data model (Prisma, `packages/gp-api/prisma/schema/`)

- **`ExperimentRun`** (`experimentRun.prisma`, table `experiment_run`) — `runId`
  (`@unique`), `organizationSlug` (FK → `Organization.slug`), `experimentType`,
  `status` (`ExperimentRunStatus { QUEUED, RUNNING, AWAITING_RESUME, COMPLETED,
FAILED }`), `priority`, `params` (JsonB), artifact pointers `artifactBucket` /
  `artifactKey` (S3 keys, **not** the artifact body), plus `durationSeconds`,
  `costUsd`, `error`, `stage`, `dataQuality`, `resumeScheduledFor`, `resumeAttempts`.
- **`MeetingBriefing`** (`meetingBriefing.prisma`) — one row per
  `(electedOfficeId, meetingDate)`; points at S3 and caches a typed JSONB copy of the
  artifact.
- **`MeetingResourceLocation`** — discovered schedule/agenda location hints,
  referencing the producing `experimentRunId`.
- **`CommunityIssue`** (`communityIssue.prisma`) — stamped with `lastRefreshedRunId`.
- **`ArtifactReview`** (`artifactReview.prisma`) — polymorphic human pass/fail
  verdict (`verdict ∈ {passed, failed}`, `resourceType ∈ {briefing,
community_issues_top, community_issues_trending}`), unique on
  `(resourceType, resourceId)`, last-write-wins. Reviewer is stored as
  `reviewerClerkSub`/`reviewerEmail` strings (gp-admin is a different Clerk instance,
  so no FK). `'pending'` = absence of a row.
- **`ArtifactFeedback`** — per-user thumbs up/down on an agenda item.

### Result-callback handling

The single FIFO results queue is consumed in
`src/queue/consumer/queueConsumer.service.ts`. The
`QueueType.AGENT_EXPERIMENT_RESULT` case parses with `AgentExperimentResultSchema`
(`src/queue/queue.types.ts`) and calls `handleAgentExperimentResult`:

```ts
// AgentExperimentResultSchema
{ runId, status: 'started' | 'success' | 'failed' | 'contract_violation',
  artifactKey?, artifactBucket?, durationSeconds?, costUsd?, error? }
```

- Missing run → ack + drop. Already-terminal run → log + drop (idempotency; this is
  what makes the `gp-ai-projects` ECS reaper safe to fire after a real success).
- `'started'` → `markStarted` advances `QUEUED → RUNNING`.
- `'success'` → `resolveSuccessPatch` is the **only place gp-api reads the artifact
  body during the callback**: it `s3Service.getFile(bucket, key)`s to read `stage`,
  `data_quality.overall`, and `next_action.scheduled_for`, then decides terminal vs
  resumable (`partial` + resumable type → `AWAITING_RESUME`; `failed` → `FAILED`;
  else `COMPLETED`). Any S3 read failure falls back to `COMPLETED` so a transient miss
  never strands a run.
- The patch is applied via `optimisticLockingUpdate` on `updatedAt`, re-checking
  terminal status inside the lock.
- On `COMPLETED`, it fans out to product hooks (`.catch`-wrapped so a write failure
  doesn't requeue): `meetingBriefings.onExperimentRunCompleted`,
  `communityIssue.onExperimentRunCompleted`, `campaignStrategy.onExperimentRunCompleted`.

So gp-api **stores the S3 key and re-fetches the body on demand** — once in the
callback to classify, again in each product hook to persist sections. Only
`MeetingBriefing` keeps a JSONB cache of the artifact.

### Sweeps and recovery

> **Doc correction:** there is **no 45-minute time-based stale sweep in gp-api** — it
> was deliberately removed in favor of the `gp-ai-projects` ECS task-reaper (below). A
> lingering `// 45-minute stale sweep` comment in `queueConsumer.service.ts` is stale
> wording, not live behavior.

The sweeps that do exist:

- **`sweepResumableRuns`** (`@Cron('*/5 * * * *')` in `experimentRuns.service.ts`) —
  the compliance/resume loop, not a staleness sweep. Picks `AWAITING_RESUME` rows due
  for resume, re-dispatches a successor, terminalizes the old row. Caps at
  `MAX_RESUME_ATTEMPTS = 5`; exhaustion alerts the bot-10DLC-compliance Slack channel.
- **CampaignStrategy grace-window backstop** (`campaignStrategy.service.ts`,
  `sectionState`) — a poll-driven `PERSIST_GRACE_MINUTES` window before a
  `COMPLETED`-but-unpersisted run is redispatched.
- There is **no backstop sweep for runs stuck `QUEUED` forever** on the gp-api side
  (accepted by design; rare, needs manual cleanup).

### Products built on this

Automated dispatch is wired off `ElectedOfficeService.dispatchScheduleAfterCreate`,
which calls `meetingBriefings.onElectedOfficeCreated` and
`communityIssueDispatch.onElectedOfficeCreated` (both `.catch`-wrapped, outside the
create transaction).

- **Meeting briefings** (`src/meetings/services/meetingBriefings.service.ts`) — two
  experiments, `meeting_schedule` then `meeting_briefing`. Signup dispatches the
  schedule; schedule completion chains a briefing if the **imminence gate** passes (a
  projected meeting within `IMMINENCE_WINDOW_DAYS = 3`). `dispatchDailyBriefings`
  (`@Cron('0 7 * * *')`) claims a once-per-day lease via `CronLockService` (one ECS
  replica), then dispatches for every eligible office. The "brief now" UI path
  bypasses the gate and widens the window to 60 days. User-supplied agendas ride as
  `agendaPacketUrl` in params or under `params._input_files`.
- **Community issues** (`src/communityIssues/services/communityIssueDispatch.service.ts`)
  — two experiments, `top_community_issues` + `trending_issues`. Daily crons bucket
  orgs across the week/month so load is spread; cap at `DISPATCH_CAP_PER_TICK = 200`.
  `onExperimentRunCompleted` re-reads S3, validates, **verifies the artifact's
  `organization_slug` and `generated_for_run_id` match the run** (anti-cross-
  contamination), then upserts.
- **Campaign strategy** (`src/campaignStrategy/`) — experiments `opposition_research`
  - `opportunities_and_challenges`, persisted section by section.

**ICP gating** (`OrganizationsService.resolveServeContext`): automated dispatch
**fails closed** — `ctx.isServeIcp !== true` (false, null, _and_ undefined) skips
dispatch. `isServeIcp` traces back to election-api's position data, ultimately the
Databricks `int__icp_offices` table.

### Admin / bulk-dispatch surface

- `POST /v1/meetings/briefings/dispatch` (`UserOrM2MGuard`) — M2M callers dispatch
  for any office; `useImminenceGate: true` matches the cron exactly. The
  `bulk-briefing-cohort` skill drives this (~$6 per briefing).
- `POST /v1/community-issues/dispatch` (`AdminOrM2MGuard`) → `dispatchForCohort`. The
  `bulk-community-issues-cohort` skill's endpoint.
- `admin/agent-runs` (`src/admin/agentRuns`, `M2MOnly`) — list, detail (incl. S3
  artifact + `conversation.log`), and retry (`compliance_setup` only).
- `admin/briefings` + the review-verdict controller
  (`src/artifactReview/controllers/briefingReviewVerdict.controller.ts`) — gp-admin's
  human-review surface that writes `ArtifactReview` rows.

The SQS/S2S payload schemas (`AgentExperimentResultSchema`, the dispatch envelope)
live in **gp-api's local `src/queue/queue.types.ts`**, not in
`@goodparty_org/contracts`. What's in `contracts` is the admin **read** surface
(`AgentRun.schema.ts`, `ArtifactReview.schema.ts`, `AdminBriefing.schema.ts`).

## Part 2 — gp-ai-projects: the engine

`gp-ai-projects/pmf_engine` (control plane + runner) and `broker` are two members of
a `uv` Python workspace. In code the whole thing is the **PMF Engine** — the
CloudWatch metric namespace is literally `PMFEngine`.

### Dispatch and concurrency (control plane)

`pmf_engine/control_plane/` is three Lambdas:

- **`dispatch_handler`** — triggered by `agent-dispatch-{env}.fifo`. Strictly
  validates the envelope, resolves routing from the **S3 manifest loader** (reads
  `index.json` + `{id}/manifest.json` from `agent-experiment-metadata-{env}`, pinning
  S3 VersionIds so a publish mid-queue can't swap the bytes a run executes), runs
  Draft-07 JSON-Schema validation of `params` against the manifest's `input_schema`,
  and writes a `QUEUED` job to DynamoDB. It **never** mints a token or calls RunTask.
- **`scheduler_handler`** — the **only caller of `ecs:RunTask`**, pinned to
  `reserved_concurrent_executions = 1`. Triggered by the job table's DynamoDB stream
  (second-latency arrival) and a 1-minute EventBridge tick (slot-freed
  reconciliation). Each tick reads the live cap from SSM
  (`/pmf-engine/{env}/max-concurrent-agents`, falls back to a hard floor of **50**),
  counts running Fargate tasks, computes free slots, claims that many jobs from a
  sparse priority-ordered GSI, mints a per-run broker token, and launches.
- **`task_reaper`** — EventBridge target for ECS Task-State-Change (STOPPED). If a
  task stops with a **non-zero exit code** (OOM/eviction/failed-to-start) the runner
  never published a result, so the reaper sends a `failed` callback. A clean exit is
  left alone — the runner reported its own result.

**Why the cap is exact:** exactly one scheduler runs at a time and is the sole
RunTask caller, counting `desiredStatus=RUNNING` tasks against the SSM cap each tick.
The per-job conditional claim only prevents double-claiming the _same_ job; the
single-scheduler invariant is what makes `MAX_CONCURRENT_AGENTS` a true ceiling. An
operator can retune it live with one `ssm put-parameter`, no deploy.

> **Operational note:** the infra-level cap works, but the binding constraint in
> practice has been the **Anthropic credit balance** — a 200-concurrent cohort can hit
> a credit cliff mid-run. Pace large cohorts around a cap of ~50. (See the memory note
> `bulk-briefing-concurrency-credits`.)

### The broker — the security boundary

`gp-ai-projects/broker` is a FastAPI/uvicorn service on ECS Fargate, behind an
internal ALB at `broker-{env}.ai.goodparty.org`. It is the **single trusted egress**
for every run: it holds all API credentials, proxies every external call, scopes
Databricks queries, validates artifacts, and signs the callback gp-api consumes.

The design intent: a prompt-injected agent **cannot exfiltrate data or affect other
runs**. The runner task is an **untrusted quarantine** — empty IAM role, no Secrets
Manager access, AWS metadata endpoint disabled, and a security group that allows only
four egress destinations (broker:8080, ECR+Logs VPC endpoints, the S3 prefix list,
and VPC DNS). The agent's only path out is broker-proxied tools. The broker is
deliberately consumer-domain-agnostic — it sees `experiment_id` and
`organization_slug` as opaque strings, so other consumers (e.g. `engineer_agent`) can
reuse it.

Per-run auth is a `ScopeTicket` in the broker's DynamoDB table, keyed by a UUID
`broker_token` the scheduler mints at launch (TTL'd, deleted on publish — anti-replay).
Endpoints the runner uses: `/anthropic/v1/messages` (proxies to Anthropic, injects
the real key), `/braintrust/*` (trace ingest), `/databricks/query` (scope-rewritten
SQL), `/http/fetch` + `/http/head` (the **only** URL-retrieval path,
Playwright-backed), `/artifact/publish`, `/artifact/read` (prior-artifact chaining),
`/inputs/read` (user uploads), `/experiment/manifest`, `/agent/mcp` (proxies MCP tool
calls to gp-api for write-action experiments), and the internal
`/internal/{mint,delete}-run-token` + `/internal/run-status`.

### The runner — the agent itself

`pmf_engine/runner/main.py` is the Fargate entrypoint; `runner/harness/claude_sdk.py`
is the agent loop, built on **Anthropic's Claude Agent SDK** (`claude_agent_sdk`,
Python). The model comes from the manifest (`AGENT_MODEL`; default `sonnet`).

- **Tools:** `Bash`, `Write`, `Edit`, `Glob`, `Grep`, `WebSearch`. **`WebFetch` is
  deliberately excluded** — it would need direct egress the SG denies; all fetches go
  through the broker. Manifests can extend the list (`allowed_external_tools`), and
  write-action experiments get an HTTP MCP server pointed at `{BROKER_URL}/agent/mcp`.
- **System prompt** (`build_system_prompt`) injects the date, the turn budget (with a
  hard "never fabricate data" instruction), the network-quarantine + escalation-ladder
  doc, and the OUTPUT CONTRACT rendered from the manifest's output schema. **Untrusted
  params are never rendered into the system prompt** — they arrive in the first user
  message fenced in `<untrusted_data>` tags. This is the primary prompt-injection
  defense given the agent has `Bash` and bypass-permissions.
- **Researcher subagents** (opt-in via `manifest.runtime.max_parallel_subagents`):
  the harness registers a single `researcher` `AgentDefinition` and adds the SDK's
  `Agent` dispatch tool. The parent is told to dispatch one researcher per independent
  item (each opponent, district, agenda item — this is the "pass `race_context` to
  researcher subagents" pattern). Researchers inherit the exact same broker-proxied
  tool surface and model, are forbidden from recursing, and **never write the
  artifact** — only the parent assembles `/workspace/output/`. Fan-out is clamped to 20.
- **Artifact contract:** the agent writes `/workspace/output/*.json`; the runner
  validates it (Draft-07) against the manifest's output schema before publish. On a
  contract violation the broker quarantines the rejected artifact to
  `s3://.../rejected/{run_id}.json` and sends a `contract_violation` callback.

**Anti-fabrication gate (broker publish path):** if the manifest declares
`scope.allowed_tables` but the broker saw **zero** successful Databricks queries for
this run, it refuses to publish — schema validation alone can't tell synthetic data
from real, so the broker enforces "you must have actually queried" (with a
`data_required_unless` carve-out for legitimate no-data placeholders like
`briefing_status = awaiting_agenda`).

### Artifacts in S3

The broker writes two keys: an immutable per-run archive
`s3://gp-agent-artifacts-{env}/{experiment_id}/{run_id}/artifact.json` (write-once)
and a mutable convenience pointer `{experiment_id}/{organization_slug}/latest.json`.
The **callback always carries the run-scoped key**, never `latest.json`, so dependent
experiments get a stable artifact. That `{artifactBucket, artifactKey}` is the
"resource location" gp-api persists.

### Infrastructure

IaC is **Terraform** under `gp-ai-projects/infrastructure/`. Four PMF stacks:
`pmf-vpc-endpoints` (shared ECR/Logs/S3 endpoints), `broker` (ECS service, ALB +
cert, scope-ticket DynamoDB, secrets), `pmf-engine-fargate` (runner cluster + empty
task role + quarantine SG + Slack failure topic), and `pmf-engine-control-plane`
(the three Lambdas, dispatch FIFO + DLQ, job-queue DynamoDB, metadata + inputs S3
buckets, SSM cap param, EventBridge rules). CI builds the broker and pmf-engine
images on merge to `main`. Ops detail: `broker/RUNBOOK.md`.

## Part 3 — the eval system

There are **two distinct eval systems**; don't conflate them.

### PMF experiment eval (the recent, primary one)

Landed as PR #241 (2026-06-19, ported from the standalone `runbooks` repo), it lives
in `packages/runbooks` — `books/` (the methods), `experiment-evals/` (the adopted
bars, per experiment), `scripts/python/` (the engine). **It is not Braintrust-based**
at its core: it reads each run's `artifact.json` and `conversation.jsonl` **from S3,
from the outside, after the run** — so the agent cannot inflate its own grade.

Front door: `packages/runbooks/books/pmf-eval-system.md`.

It gates on **two axes** with a deliberate asymmetry:

- **Performance — objective, can BLOCK.** Did it produce an artifact, at what
  turns/cost/error rate? These are facts (validity by construction), so the gate can
  flatly block. Measurement is **mechanical, no LLM** (`scripts/python/`):
  `eval_trajectory.py` (turns/cost/errors from a trace, plus `--ab` diffs),
  `perf_gate.py` (one run + config → PASS/FLAG/FAIL), `derive_perf_thresholds.py`
  (many runs → tuned p95 ceilings in `perf.json`), `perf_monitor.py` (drift alarm),
  `faithfulness_check.py` (mechanical identity-figure check against the
  runner-persisted raw download, not the artifact's own snapshot, so an optimizer
  can't fake both sides). The one universal hard FAIL is `NO_ARTIFACT`. "No AI sets
  the thresholds, so the gate cannot be gamed."
- **Quality — judgment, ADVISES only.** Is the output good and faithful? Applied by
  **cold-judge subagents** (a fresh subagent reads only the rubric + one artifact,
  having never seen the rubric being built). Spawn 2+ per artifact; the inter-judge
  spread is the **reliability signal**, tallied by `rubric_verdict.py` into a GO/NO-GO
  on reliability (not on the artifact). Quality is reliable but not yet _valid_ (not
  proven to match human taste), so it never silently blocks.

The bar lives in **git** (`experiment-evals/<exp>/perf.json` +
`quality_rubric.md` + `validation_log.md` + `rubric_scores.tsv`), so changing a
threshold is a reviewable commit. `experiment-evals/` is kept deliberately separate
from `experiments/` so eval files are never published to S3 or read at runtime. Rubric
shape: two pass/fail gates first (eligibility, then faithfulness/grounding), one
"spine" dimension (the thing the user pays for), and 3-6 supporting dimensions scored
1-5 — the hard lesson being **gate the fatal things, score the rest**, because a fatal
flaw expressed as a low score on a summed scale just averages away.

**The everyday loop** (`books/evaluate-experiment-runs.md`): clone the experiment to
`<exp>_v2`, change **only** `instruction.md`, publish to dev, dispatch the same fixed
input set through both arms, pull traces+artifacts from S3, run the performance gate
(`--ab`) and optionally cold-judge quality, then adopt v2 only on a performance PASS
with outcome and quality parity. This is exactly what an autonomous
prompt-improvement loop runs, with an engineer reviewing what it adopts.

A rubric can also be compiled into an **in-run QA gate** (`experiments/<exp>/qa/`,
e.g. `meeting_briefing/qa/`) — a single LLM judge that runs inside the run after the
artifact is produced. v1 is **observe-only** (`blocking: false`): the verdict rides
into S3 but never blocks publish.

### Braintrust sandbox (older, narrower)

`gp-ai-projects/braintrust_eval_sandbox` is a PM-facing **prompt A/B playground** — a
generic two-stage Gemini pipeline (grounded search → structured output) driven by
Braintrust playground parameters, so PMs can A/B-test prompts with no per-prompt
engineering. It is Braintrust-based (`evals.py` defines one `Eval()`), ships **no
scorers** (`scores=[]` — written in the Braintrust UI per use case), and is pushed
with `push_eval_to_braintrust.sh` (needs `BRAINTRUST_API_KEY`). It predates the PMF
eval system by about a month and is independent of it.

### How Braintrust relates to the runtime

Separately from the eval _gates_, every PMF run **logs traces to Braintrust at
runtime** — the runner routes its Braintrust SDK traffic through the broker's
`/braintrust/*` proxy. The runbooks gates don't consume Braintrust yet;
`pmf-eval-system.md` flags it as the future home for trend telemetry.

## Notable design properties

- **Quarantine is enforced at the network/IAM layer, not by trusting the agent** —
  empty task IAM, disabled metadata endpoint, four-destination SG, per-run TTL'd token.
- **Defense in depth against fabrication** — schema validation plus the broker's
  "you must have actually queried" gate plus the eval system's gaming-resistant
  faithfulness check against agent-uncontrolled raw downloads.
- **Version pinning end to end** — dispatch captures S3 VersionIds and threads them
  through the job row → container env → broker fetch, so a manifest publish mid-flight
  can't change what a run executes.
- **Every terminal path is broker-down-safe** — layered runner fallbacks, the
  scheduler's stuck-LAUNCHING sweep, the ECS task-reaper, and gp-api's terminal-status
  idempotency, all so a run never hangs in `RUNNING`/`QUEUED` forever.
