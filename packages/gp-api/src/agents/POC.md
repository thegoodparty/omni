# Agents on the AI SDK with our own stage runner (POC)

Prototype for ClickUp 17tnw2b5rd0, branch `poc/agents-ai-sdk`. It will not
merge and never deploys to production. Design notes:
https://agent-consolidation-sub-problems.artifacts.goodparty.org ("Solution 1").
The shared base (registry, tools, meeting briefing stages, judge arm, dev
tools, observability helpers) is `poc/agents-base`; this branch adds the
engine.

## What the engine is

| Piece           | File                                 | What it does                                                                   |
| --------------- | ------------------------------------ | ------------------------------------------------------------------------------ |
| `AGENT_RUNTIME` | `aiSdk/aiSdkAgentRuntime.service.ts` | `run`, `getRun`, and the `agentRun` worker (`execute`)                         |
| Stage runner    | `aiSdk/aiSdkStage.ts`                | One stage on the AI SDK's own tool loop (`streamText`), a row after every step |
| Shape hash      | `aiSdk/shapeHash.ts`                 | Stage names, order and output schemas, hashed                                  |
| Models          | `aiSdk/agentModels.ts`               | Model id to `@ai-sdk/anthropic` model (tests swap in a mock)                   |
| Chat path       | `aiSdk/aiSdkChatRuntime.service.ts`  | A registry chat agent turned into today's `ChatStreamService` turn             |
| Briefing chat   | `briefingChat/briefingChat.agent.ts` | `briefing_annotation` as a registry `ChatAgentDefinition`                      |
| Queue           | `jobs/jobs.registry.ts` `agentRun`   | One queue for every agent, `maxConcurrent: 10` fleet-wide                      |

### Run state

A run is a `ChatConversation` (scope `background_agent`, no owner user,
`organizationSlug` is the owner). Each stage is a child `ChatConversation`
with `parentRunId`. Each model step is one assistant `ChatMessage` whose new
`step` column holds the messages the step added, tool results included, and
its token usage. New columns (migration
`20261114000000_agent_runs_on_chat_conversation`): `status`, `parent_run_id`,
`shape_hash`, `shape_stamped_at`, `agent_name`, `run_input`, `run_output`,
`run_error`, `judge_replay` on `chat_conversation`; `step` on `chat_message`;
`owner_user_id` is now nullable; `ChatScope` gains `background_agent`.

### Resume

The `agentRun` job's retry loads the run, skips completed stages (their
saved output is the stage's state), rebuilds the running stage's messages
from its saved steps and calls `streamText` again from there. On SIGTERM the
job's abort signal is a stop condition: the in-flight step finishes and is
saved, the job throws and `JobsService` requeues it without spending an
attempt. A SIGKILL loses the step in flight; pg-boss's heartbeat retries the
job. Tools get a signal that aborts only on a pg-boss timeout, never on a
deploy, so the current step can finish. `stepKey` is
`<stage>:<step>:<tool>:<n>`, the same when a step is redone.

### Shape hash rule

`run()` stamps `shapeHash` and the stamping task's boot time. On each
attempt: same hash, continue; different hash and the run was stamped by a
task that booted after this one, hand the job back (throw, retry later on a
newer task); otherwise start over: every live stage row is marked
`superseded` and the run is restamped. `getRun` keeps the run id. The
hand-back branch is covered by `aiSdkAgentRuntime.test.ts`; the kill test
covers the start-over.

### Stage output

Each stage gets a `submitOutput` tool whose input is `{ output: <stage
schema> }`. The stage ends on the first accepted call. The model sees the
JSON schema; Zod checks it in `execute`, so a miss returns Zod's list of
problems (not the whole input) and the model resubmits. Strict structured
output was not used: `MeetingBriefingSchema` is a top-level union with
length limits. A reply cut off at the output limit is asked again once with
a nudge; a second cut-off fails the stage.

### Briefing chat

`POST /v1/briefing-chats/:annotationId/messages` now runs the registry's
`briefingChat` on the engine (`AiSdkChatRuntime`). The prompt, context and
per-turn tools are still the `BriefingAnnotationHandler`'s, so the webapp
sees the same SSE chunks and rows. The tools are `AgentTool`s that look up
the handler's per-turn tool by conversation id; `district_insights`' table
list moves from its description into the system prompt, because an
`AgentTool` is defined once for every conversation. The handler reads
`MeetingBriefing.artifact` first, which is where the background agent
writes. Turns run inside `withAgentRun` with the conversation id as the run.

### Observability

Every run runs inside `withAgentRun({ runId, agent, shapeHash })`, every
stage inside `withStageSpan`, every tool through `instrumentTool`, and every
model call with the AI SDK's telemetry on and inputs and outputs off. The
base's span processor stamps the run on every span. Nothing shows in
Grafana's Agent Observability until a Grafana Cloud admin turns it on for
the stack (Swain).

## How to run each demo

Laptop setup used here: a database of its own (`poc_agents_ai_sdk` on the
local Postgres, `prisma migrate deploy`), one real dev office copied into
it, dev's election database, Databricks and Anthropic keys from
`GP_API_DEV`, and a local Chromium for the browser
(`AGENT_BROWSER_CDP_URL`, started with `--use-mock-keychain
--password-store=basic`). AgentCore is not reachable from a laptop: the
engineer SSO role has no `bedrock-agentcore:StartBrowserSession`.

```bash
npm run poc:agent -w packages/gp-api -- work                 # a worker for agentRun only
npm run poc:agent -w packages/gp-api -- start <electedOfficeId> [meetingDate] [--watch]
npm run poc:agent -w packages/gp-api -- view <runId> [--watch] [--json]
npm run poc:kill-test -w packages/gp-api -- <electedOfficeId> [meetingDate]
npm run poc:kill-test -w packages/gp-api -- <electedOfficeId> [meetingDate] --change-shape
```

Briefing chat: open the briefing in the webapp against this gp-api; the
chat panel is unchanged. `briefingChat.agent.test.ts` drives it through the
API over a briefing saved by the agent's `onArtifact`.

## Live run

Run `cmwfnm0b80000sn2bqwu52h4g`, the three-stage `meetingBriefing` for the
Methuen City Council (At Large) office on dev
(`019e2e92-3cb6-7883-91f7-706da505b032`), meeting of 2026-11-16, with
real Sonnet 4.6 calls, real web fetches and real Databricks reads.

| Stage         | Steps | Output                                                                                                                 |
| ------------- | ----- | ---------------------------------------------------------------------------------------------------------------------- |
| findAgenda    | 7     | `found: true`, `agenda_found`, packet URL on the city's AgendaCenter, 4 documents, 19 agenda items                     |
| readPacket    | 2     | 19 items triaged from the official's community issues                                                                  |
| writeBriefing | 9     | `briefing_ready`, 19 items (3 featured, 3 queued, 13 standard), 3 in the executive summary, 11 sources, 100 KB of JSON |

`onArtifact` wrote the `MeetingBriefing` row for 2026-11-16 19:00 with
`artifact` set and no ExperimentRun or S3 pointer. Cost recorded by the
engine: **$5.15**. That leaves out one step lost to a dropped connection
(below), so the real spend was somewhat higher. Shape hash `f83a4be64303`
throughout.

What happened along the way, all on one run id:

1. Attempts 1 to 3 failed at once: the laptop's Anthropic key was stale.
   pg-boss retried; switching to dev's key fixed it.
2. findAgenda and readPacket finished. The worker was then stopped with
   SIGTERM three times by a process outside this lane. Each time the step in
   flight finished and was saved, the job was requeued without spending an
   attempt, and a new worker carried on from the saved step.
3. writeBriefing's final step streamed for 17.5 minutes and died with
   `ECONNRESET`. That step was lost and the attempt failed.
4. The next attempt hit the 32k output limit three times in a row: the
   whole briefing as one `submitOutput` argument is more than 32k tokens.
   I stopped the worker (SIGKILL, so pg-boss dead-lettered the job), raised
   the limit to 64k, added the cut-off nudge, redrove the job, and the run
   resumed at writeBriefing step 8 under the new code. The shape hash didn't
   change, so nothing restarted.
5. The first full submission failed Zod (four titles and overviews over
   their length limit). The model fixed them and the second was accepted.

## Kill tests

Both pass, against the same office and meeting, with `--kill-after-steps 1`.
readPacket here saves only one step before its long final call, so the
default of 2 never reaches the kill point.

**Resume (SIGTERM, a deploy).** Run `cmwfuenze0000snd3bzn4xi83`, $2.81.
Worker A was killed during readPacket after it had saved 1 step;
findAgenda had finished in 8. Worker B kept findAgenda as it was (8 steps,
not rerun) and finished readPacket from its saved step (3 steps in all).
The shape hash `f83a4be64303` was unchanged, and the run completed
`briefing_ready`. Verdict: `outcome resumed, expected resumed: PASS`.

**Shape change.** Run `cmwfvh2860000sn268yqjmqmd`, $2.81 in all. The
superseded attempt (5 findAgenda steps and 2 readPacket steps) is
included. Worker A was killed during readPacket. The harness then added a
field to `PacketNotesSchema` and rebuilt, and worker B booted on the new
code. B saw shape `f83a4be64303` on a run stamped before it booted, marked
both stage rows `superseded`, restamped the run `2152b8cf8898`, and started
again at findAgenda. The run id stayed the same and the run completed
`briefing_ready`. Verdict: `outcome started_over, expected started_over:
PASS`.

The test harness itself needed two fixes:

- The observer's first view after the restart is now the first one that
  differs from the views before it. Worker B only claims the job a minute
  after a kill.
- The `--json` view escapes U+2028 and U+2029. Node's readline splits lines
  on them, and page text carries them.

## What we own (non-blank lines)

Engine (this branch):

| Area                                                                                    | Lines     |
| --------------------------------------------------------------------------------------- | --------- |
| Runtime: run, getRun, worker, resume, shape rule (`aiSdkAgentRuntime.service.ts`)       | 445       |
| Stage runner on the AI SDK loop (`aiSdkStage.ts`)                                       | 288       |
| Shape hash, model factory                                                               | 37        |
| Chat path (`aiSdkChatRuntime.service.ts`)                                               | 116       |
| Briefing chat definition (`briefingChat.agent.ts`)                                      | 99        |
| Schema, migration, queue entry, module wiring, briefing-chat service                    | about 150 |
| Tests (`aiSdkAgentRuntime.test.ts`, `aiSdkStage.test.ts`, `briefingChat.agent.test.ts`) | 466       |

Shared base, the same on either engine: web tools 1,681, meeting briefing
definition and schemas 1,067, stage prompts 1,738 (Markdown), observability
helpers 134, dev tools 383, registry and service 164.

So the AI SDK path costs us about 900 lines of engine on top of the base,
and the run state, resume, stage routing and shape rule in it are ours to
keep correct.

## What this showed

- **Resume works and is cheap to reason about.** Everything is rows we can
  query: a stage's steps are `ChatMessage` rows with the exact messages the
  next call sends. The live run survived a stale key, three outside
  SIGTERMs, a dropped connection, a dead letter and a code change.
- **The weak spot is the step, not the run.** A step is one model call, and
  writeBriefing's last step writes the whole briefing (30k+ tokens, 8 to
  16 minutes) as one tool argument. A dropped connection or the output
  limit loses all of it, and each Zod miss costs a full resubmission. Any
  engine has this; the fix is in the agent's shape (write the briefing in
  parts), not the runner.
- **The AI SDK has pitfalls that are now ours.** `onStepFinish` swallows
  errors, a non-streaming call dies at Node fetch's five-minute header
  timeout, `response.messages` is cumulative, and a cut-off tool call saves
  an empty assistant message the provider then refuses. Each is handled in
  `aiSdkStage.ts`, but we found them by running it.
- **Chat moved with almost no code.** The chat loop was already the AI SDK
  on these tables, so the registry definition plus a 116-line adapter was
  enough. One behaviour change: the registry's `ChatAgentDefinition` has
  one `model`, so briefing chat lost its Opus fallback.
- **AgentCore was not exercised here.** The laptop role cannot start a
  browser session; runs used a local Chromium over CDP. The preview stack's
  task role has the grant (base branch).
- **Not done:** Grafana Agent Observability shows nothing until it is
  enabled for the stack (Swain). The judge arm was not run against this
  engine. Briefing chat was driven through the API with a stubbed model, not
  a live one.
