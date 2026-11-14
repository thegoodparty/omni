# Agents on the AI SDK, one conversation per run (POC)

Prototype for ClickUp 17tnw2b5rd0, branch `poc/agents-ai-sdk-single`. It
will not merge and never deploys to production. Design notes:
https://agent-consolidation-sub-problems.artifacts.goodparty.org ("Solution
1"). It starts from `poc/agents-ai-sdk` (#3812) and drops its stages: a
background run is one long conversation. Subagents may come later.

## What the engine is

| Piece           | File                                 | What it does                                                                |
| --------------- | ------------------------------------ | --------------------------------------------------------------------------- |
| `AGENT_RUNTIME` | `aiSdk/aiSdkAgentRuntime.service.ts` | `run`, `getRun`, and the `agentRun` worker (`execute`)                      |
| Loop            | `aiSdk/aiSdkLoop.ts`                 | The run on the AI SDK's own tool loop (`streamText`), a row after each step |
| Shape hash      | `aiSdk/shapeHash.ts`                 | The agent's output schema, hashed                                           |
| Models          | `aiSdk/agentModels.ts`               | Model id to `@ai-sdk/anthropic` model (tests swap in a mock)                |
| Chat path       | `aiSdk/aiSdkChatRuntime.service.ts`  | A registry chat agent turned into today's `ChatStreamService` turn          |
| Briefing chat   | `briefingChat/briefingChat.agent.ts` | `briefing_annotation` as a registry `ChatAgentDefinition`                   |
| Queue           | `jobs/jobs.registry.ts` `agentRun`   | One queue for every agent, `maxConcurrent: 10` fleet-wide                   |

A background agent is `defineAgent({ input, output, model, prompt, tools,
onArtifact })`. Meeting briefing is one agent: the whole instruction
(`prompts/meeting-briefing.md`) with every tool the three stages used
(webSearch, fetchPage, checkLink, readDocument, searchDocument,
officialPriorities, queryVoters).

### Run state

A run is one `ChatConversation` (scope `background_agent`, no owner user,
`organizationSlug` is the owner). Its first `ChatMessage` is the input as a
user message. Each model step is one assistant `ChatMessage` whose `step`
column holds the messages the step added, tool results included, and its
token usage. Nudges are user messages. New columns (migration
`20261114000000_agent_runs_on_chat_conversation`): `status`, `shape_hash`,
`shape_stamped_at`, `superseded_by_run_id`, `agent_name`, `run_input`,
`run_output`, `run_error`, `judge_replay` on `chat_conversation`; `step` on
`chat_message`; `owner_user_id` is now nullable; `ChatScope` gains
`background_agent`.

### Resume

The `agentRun` job's retry loads the run's messages in order, rebuilds the
model messages from the saved steps and calls `streamText` again from
there. If the saved steps already hold an accepted `submitOutput`, the run
goes straight to `onArtifact`. On SIGTERM the job's abort signal is a stop
condition: the in-flight step finishes and is saved, the job throws and
`JobsService` requeues it without spending an attempt. A SIGKILL loses the
step in flight; pg-boss's heartbeat retries the job. Tools get a signal that
aborts only on a pg-boss timeout, never on a deploy. The run has a budget of
120 steps. `stepKey` is `<step>:<tool>:<n>`, the same when a step is redone.

### Shape hash rule

The shape hash is the hash of the agent's output schema. Prompts, models
and tools are left out, so changing them never restarts a run in flight.
`run()` stamps it and the stamping task's boot time. On each attempt: same
hash, continue; different hash and the run was stamped by a task that
booted after this one, hand the job back (throw, retry later on a newer
task); otherwise, in one transaction, mark the run `superseded`, set its
`superseded_by_run_id`, create a fresh run row with the same input and
judge replay ticket, and queue it. The superseded run keeps its steps and
cost. `getRun` on it returns `supersededBy`; the dev view, the kill test and
the judge's in-process runner follow it.

### Output

The run gets a `submitOutput` tool whose input is `{ output: <output
schema> }`. The run ends on the first accepted call. The model sees the
JSON schema; Zod checks it in `execute`, so a miss returns Zod's list of
problems (not the whole input) and the model resubmits. A reply cut off at
the output limit is asked again once with a nudge; a second cut-off fails
the attempt. A separate spike decides whether the AI SDK's structured
output replaces this.

### Briefing chat

`POST /v1/briefing-chats/:annotationId/messages` runs the registry's
`briefingChat` on the engine (`AiSdkChatRuntime`). The prompt, context and
per-turn tools are still the `BriefingAnnotationHandler`'s, so the webapp
sees the same SSE chunks and rows. The handler reads
`MeetingBriefing.artifact` first, which is where the background agent
writes. Turns run inside `withAgentRun` with the conversation id as the run.

### Observability

Every run runs inside `withAgentRun({ runId, agent, shapeHash })` and one
`invoke_agent <agent>` span (`withInvokeAgentSpan`), every tool through
`instrumentTool`, and every model call with the AI SDK's telemetry on and
inputs and outputs off. Nothing shows in Grafana's Agent Observability
until a Grafana Cloud admin turns it on for the stack (Swain).

## How to run each demo

Laptop setup used here: a database of its own
(`poc_agents_ai_sdk_single` on the local Postgres, `prisma migrate
deploy`), one real dev office copied into it, dev's election database,
Databricks and Anthropic keys from `GP_API_DEV`, and a local Chromium for
the browser (`AGENT_BROWSER_CDP_URL`, started with `--use-mock-keychain
--password-store=basic`).

```bash
npm run poc:agent -w packages/gp-api -- work                 # a worker for agentRun only
npm run poc:agent -w packages/gp-api -- start <electedOfficeId> [meetingDate] [--watch]
npm run poc:agent -w packages/gp-api -- view <runId> [--watch] [--json]
npm run poc:kill-test -w packages/gp-api -- <electedOfficeId> [meetingDate]
npm run poc:kill-test -w packages/gp-api -- <electedOfficeId> [meetingDate] --change-shape
```

## Live run

Run `cmwghgfdr0000sns7u6to4bmx`, `meetingBriefing` for the Methuen City
Council (At Large) office on dev (`019e2e92-3cb6-7883-91f7-706da505b032`),
meeting of 2026-11-16, with real Sonnet 4.6 calls, real web fetches and
real Databricks reads. No kills and no retries.

- 8 steps in 7 minutes. Tools by step: officialPriorities and checkLink;
  readDocument; fetchPage; readDocument (3 calls); readDocument (4);
  queryVoters and web_search; web_search and checkLink; `submitOutput`.
- `briefing_ready`, 15 items (3 featured, 2 queued, 10 standard), 3 in the
  executive summary, 13 claims, 8 sources, 69 KB of JSON. The first
  submission was accepted.
- The final step wrote 23k output tokens and took 6 minutes.
- `onArtifact` wrote the `MeetingBriefing` row for 2026-11-16 19:00 with
  `artifact` set and no ExperimentRun or S3 pointer.
- Cost recorded by the engine: **$0.90**. Shape hash `2be47e29c0a5`.

## Kill tests

Both pass, against the same office and meeting, with the default
`--kill-after-steps 4`.

**Resume (SIGTERM, a deploy).** Run `cmwggf7kt0000snt5b0aoe6r5`, $1.35.
Worker A was killed after the run had saved 4 steps; the step in flight
finished and was saved (5). Worker B loaded those steps, carried on from
step 6 on the same run and finished in 11 steps, `briefing_ready` with 13
items. The shape hash `2be47e29c0a5` was unchanged. Verdict: `outcome
resumed, expected resumed: PASS`.

**Shape change.** Run `cmwgh2vi80000snvpyf2arscg`, $1.10 in all. Worker A
was killed after 4 saved steps (5 with the one in flight). The harness then
added an optional field to `MeetingBriefingFullSchema` and rebuilt, and
worker B booted on the new code. B saw shape `2be47e29c0a5` on a run
stamped before it booted, marked the run `superseded` (5 steps, $0.28, kept
on it) and started run `cmwgh4tf50000snz67q8dgkji` under shape
`f37acdf4512a`, which finished in 9 steps ($0.82), `briefing_ready`.
Verdict: `outcome started_over, expected started_over: PASS`.

## What we own (non-blank lines)

Engine (this branch):

| Area                                                                                   | Lines     |
| -------------------------------------------------------------------------------------- | --------- |
| Runtime: run, getRun, worker, resume, supersede (`aiSdkAgentRuntime.service.ts`)       | 375       |
| Loop on the AI SDK (`aiSdkLoop.ts`)                                                    | 288       |
| Shape hash, model factory                                                              | 30        |
| Chat path (`aiSdkChatRuntime.service.ts`)                                              | 120       |
| Briefing chat definition (`briefingChat.agent.ts`)                                     | 102       |
| Schema, migration, queue entry, module wiring, briefing-chat service                   | about 140 |
| Tests (`aiSdkAgentRuntime.test.ts`, `aiSdkLoop.test.ts`, `briefingChat.agent.test.ts`) | 423       |

Shared base, the same on either engine: web tools 1,681, meeting briefing
definition and schemas 892, the prompt 741 (Markdown), observability
helpers 133, dev tools 367, registry and service 154.

The engine change against `poc/agents-ai-sdk` (commit `0fde65a2ce`) is
505 lines added and 2,407 removed (34 files). Gone: the three stage prompts (1,452 lines), the stage
schemas (152), the stage routing, child stage conversations and
`parent_run_id`, the single-stage parity agent and its judge switch. The
runtime went from 446 to 375 lines; the loop is the same size.

## What this showed

- **One conversation was cheaper here.** The same office and meeting cost
  $0.90 in 8 steps and 7 minutes, against $5.15 and 18 steps for the
  three-stage live run (which also paid for output-limit retries), and the
  resume kill test cost $1.35 against $2.81. The model reads the packet and
  writes the briefing in one context, with nothing restated between
  stages. One office and one meeting is not a quality comparison; the
  judge arm is how to make one.
- **Resume is simpler to reason about.** A run is one row and its steps;
  resume is "load the steps, call the loop". There is no stage table to
  skip through and no stage output to reparse.
- **A shape change now costs a fresh run, measurably.** The superseded run
  keeps its steps and cost, and the new run id is linked from it. Callers
  that hold a run id must follow `supersededBy`.
- **The weak spot is still the last step.** The whole briefing is one
  `submitOutput` argument (23k tokens, 6 minutes here). A dropped
  connection or the output limit loses all of it.
- **Not done:** Grafana Agent Observability shows nothing until it is
  enabled for the stack (Swain). The judge arm was not run against this
  engine. Briefing chat was driven through the API with a stubbed model.
  AgentCore was not exercised: the laptop role cannot start a browser
  session, so runs used a local Chromium over CDP.
