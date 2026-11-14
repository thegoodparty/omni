# Agents on LangGraph (proof of concept)

This branch (`poc/agents-langgraph`) runs gp-api's agents on LangGraph JS.
It is a prototype for comparing engines and will not merge. Design notes:
https://agent-consolidation-sub-problems.artifacts.goodparty.org (ClickUp
17tnw2b5rd0, "Solution 3").

## What runs where

| Piece         | How it works here                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Start a run   | `AgentsService.run(name, input)` (base) calls `LangGraphAgentRuntime.run`, which writes a `ChatConversation` row (scope `background_agent`, no owner user) and sends one `agentRun` job in the same transaction. The row id is the run id and the LangGraph thread id.                                                                                                                                                                                         |
| Queue         | `agentRun` in `jobs.registry.ts`: one queue for every agent, `maxConcurrent: 4` fleet-wide, 90-minute attempts, 5 attempts.                                                                                                                                                                                                                                                                                                                                    |
| Stages        | `stageGraph.ts` turns `defineAgent`'s stages into a `StateGraph`: the input plus one state field per stage (`<stage>Output`), one node per stage, edges from `next`. Each node runs `createAgent` (from `langchain`) with the stage's prompt, model, tools and a structured-output tool built from the stage's Zod schema.                                                                                                                                     |
| Run state     | `PostgresSaver` in schema `langgraph` of the gp-api database. A Prisma migration owns the tables, so tasks never race to create them. A stage's agent loop saves under its node's checkpoint namespace in the same thread, after every model call and every round of tools (`durability: 'sync'`).                                                                                                                                                             |
| Resume        | Each attempt calls `graph.invoke(null, { thread_id })` when the thread has a checkpoint. Finished stages are not rerun, and a stage cut off midway continues from its last saved step.                                                                                                                                                                                                                                                                         |
| Deploys       | The job's shutdown signal calls `RunControl.requestDrain()`. The graph stops at the next step boundary and throws `GraphDrained`. `JobsService` puts the job back without spending an attempt.                                                                                                                                                                                                                                                                 |
| Shape changes | `shapeHash` is computed from the stage names, their order and their output schemas, not from prompts, models or tools. If the hash on the run differs from the code's, the run starts over on a fresh thread: a child row (`parentRunId`), and the old row is marked `superseded`. A task whose hash first appeared before the run's hands the job back (the attempt fails and is retried later), so an old task never restarts a run that newer code stamped. |
| Artifact      | When the graph finishes, the last stage on the route the run took is passed to `onArtifact` (`MeetingBriefing.artifact`). The stage summary and cost are copied onto the row, and then the thread's checkpoints are deleted.                                                                                                                                                                                                                                   |
| Chat          | Briefing chat (`POST /v1/briefing-chats/:id/messages`) runs the registry's `briefingChat` agent on the conversation's thread (thread id = `ChatConversation.id`). `@ai-sdk/langchain`'s `toUIMessageStream` is mapped to the webapp's existing SSE chunks, and `ChatMessage` rows are still written as the display copy. A conversation from before this branch gets its earlier turns from `ChatMessage` on its first LangGraph turn.                         |
| Observability | Every run and chat turn runs inside `withAgentRun`, every stage inside `withStageSpan`, and every tool goes through `instrumentTool`. A middleware adds one `chat <model>` generation span per model call, with token counts only. LangChain emits no OpenTelemetry of its own.                                                                                                                                                                                |
| Dev view      | `npm run poc:agent -- view <runId> [--watch]` (base CLI) reads `getRun`: stages, steps (model calls saved in the stage's namespace), status, shape hash and cost (`modelPricing.ts`; web search fees are not counted).                                                                                                                                                                                                                                         |

## Running the demos

All of these run from the build against the `DATABASE_URL` you give them.
They need a valid `ANTHROPIC_API_KEY`. The browser runs on AgentCore, or on a
local Chromium you start yourself:

```bash
"<chrome for testing>" --headless=new --remote-debugging-port=9333 \
  --user-data-dir=/tmp/agent-poc/chrome-profile --no-first-run \
  --use-mock-keychain --password-store=basic about:blank
export AGENT_BROWSER_CDP_URL=http://127.0.0.1:9333
```

Use a database of your own, not the shared local `gpdb`. Apply the
migrations, then:

```bash
npm run poc:agent -w packages/gp-api -- work                     # worker for agentRun only
npm run poc:agent -w packages/gp-api -- start <electedOfficeId> [meetingDate] --watch
npm run poc:agent -w packages/gp-api -- start --input briefing-input.json --watch
npm run poc:agent -w packages/gp-api -- view <runId>
npm run poc:kill-test -w packages/gp-api -- --input briefing-input.json           # SIGTERM mid-readPacket
npm run poc:kill-test -w packages/gp-api -- --input briefing-input.json --hard    # SIGKILL
npm run poc:kill-test -w packages/gp-api -- --input briefing-input.json --change-shape
```

Use `--input` when the database's office cannot work out its state and
position on its own, which needs the election database. The file holds a
`BriefingInputSchema` object for an office that exists in the database.

## Tests

- `langgraph/langGraphRuntime.jobs.test.ts` (through the real `agentRun`
  workers, scripted models): three stages to a saved briefing with its
  checkpoints pruned, routing past `readPacket`, a resume partway through
  `readPacket` after a failed attempt, a start-over on a fresh thread after
  a shape change, an old task handing back a run stamped by newer code, a
  drain in the middle of a stage, and what the shape hash includes and
  leaves out.
- `briefing-chats.controller.integration.test.ts`: the briefing route on
  the engine, through the API, with the SSE chunks, the `ChatMessage`
  display copy, the thread, earlier turns given to the model, and summed
  usage.

## What we own (lines, excluding tests)

| Area                                                                                                 | Lines |
| ---------------------------------------------------------------------------------------------------- | ----- |
| Stages to graph, tool adapter, model spans (`stageGraph.ts`)                                         | 325   |
| Runtime: run rows, worker, resume, drain, shape hash, progress view, pruning (`langGraphRuntime.ts`) | 440   |
| Checkpointer and module (`langGraphCheckpointer.ts`, `langGraph.module.ts`)                          | 45    |
| Cost (`modelPricing.ts`)                                                                             | 36    |
| Chat on the engine (`langGraphChat.service.ts`)                                                      | 347   |
| Briefing chat agent definition (`briefingChat/briefingChat.agent.ts`)                                | 94    |
| Migration (run columns, `langgraph` schema)                                                          | 71    |

The base, which both engines share, adds: tools 1,814, meeting briefing
1,111, observability 146, and dev tools 428.

## What we learned

- Resume in the middle of a stage works as the notes describe, as long as
  the stage agent is invoked inside its node with the node's config. A
  resumed `readPacket` got its saved tool round back, and the model was not
  asked for that step again (tested).
- A drain requested during a stage's agent loop stops the whole graph at the
  next step and resumes cleanly (tested).
- LangGraph refuses a node and a state field with the same name, so the
  state is keyed `<stage>Output` and `next` sees a view keyed by stage name.
- `toolStrategy` numbers unnamed structured-output tools per process. A
  resumed run would then call a tool that no longer exists, so every output
  tool is named `<stage>_result`. A top-level union, such as the final
  briefing, becomes one tool per member. Output is checked against the Zod
  schema after the stage, not by strict mode.
- `createAgent` writes its own closing AI message after the structured
  output. Step counts leave it out.
- `ChatAgentDefinition.tools` is fixed per agent, but briefing chat's tools
  and district scope depend on the conversation. Each tool runs the
  conversation's own tool, a tool the briefing does not offer returns "not
  available", and district_insights' table and required WHERE clause move
  from the tool description into the system prompt.
- `ChatConversation.ownerUserId` is nullable now, since a background run has
  no user. Only one type error followed, in the general chat route's scope
  type.
- Checkpoints are LangGraph's own encoding. The dev view reads stage
  progress with `getTuple` per namespace, because SQL alone cannot read it.

## Live run

Not done yet. Two blockers only Swain can clear:

- The local `ANTHROPIC_API_KEY` returns 401 from Anthropic.
- AWS SSO has expired, so the dev key and the dev gp-api database password
  cannot be read from Secrets Manager. The VPN is up and the dev database is
  reachable.

Ready to run once those are fixed: a dedicated local database with an office
for Monroe, WA (City Council Business Meeting, 17 Nov 2026, packet published
on CiviCWeb), and a headless Chrome for Testing for `AGENT_BROWSER_CDP_URL`.

## Not done

- Grafana Agent Observability shows nothing until a Grafana Cloud admin
  enables it on the stack.
- The `/v1/chats` route for `briefing_annotation` (the scope registry) still
  runs on the AI SDK. Only the briefing route the webapp uses moved.
- Chat threads are not pruned: they are the chat's memory.
