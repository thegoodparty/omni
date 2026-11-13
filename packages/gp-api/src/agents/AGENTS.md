# Agents (proof of concept)

In-gp-api agents, one registry for background and chat agents. This folder
is the engine-agnostic base the two engine branches build on
(`poc/agents-ai-sdk`, `poc/agents-langgraph`). It is never merged or
deployed to production. Design notes: ClickUp 17tnw2b5rd0.

## Key files

| Path                                         | What                                                                                                    |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `types.ts`                                   | `StageDefinition`, agent definitions, `RunView`, `AgentRuntime`                                         |
| `agents.registry.ts` / `defineAgent.ts`      | `AGENTS`; `defineAgent` erases types and validates in `onArtifact`                                      |
| `agents.service.ts`                          | `AgentsService.run(name, input, { judgeReplay? })`, the only way to start                               |
| `agents.module.ts`                           | Providers; an engine binds `AGENT_RUNTIME` here                                                         |
| `agentPrompt.ts`                             | `loadAgentPrompt(path)`: reads `prompts/<path>` (copied to `dist`)                                      |
| `tools/`                                     | `tool.ts` (`AgentTool`, `ToolContext`) and the web tools (Lane A)                                       |
| `meetingBriefing/meetingBriefing.agent.ts`   | Meeting briefing, three stages, and the single-stage parity agent                                       |
| `meetingBriefing/*.schema.ts`                | `MeetingBriefingSchema` (from the manifest), `AgendaSchema`, `PacketNotesSchema`, `BriefingInputSchema` |
| `meetingBriefing/queryVoters.tool.ts`        | Modeled sentiment means over `mart_serve_agents.serve_agent_voters`                                     |
| `meetingBriefing/officialPriorities.tool.ts` | The office's priorities and community issues                                                            |
| `prompts/meeting-briefing*.md`               | The runbook instruction, adapted to tools and split per stage                                           |
| `observability/agentRunSpans.ts`             | Grafana Agent Observability attributes, stage and tool spans                                            |
| `devTools/`                                  | Dev view, worker and kill-test CLIs                                                                     |

## Engine contract

An engine implements `AgentRuntime` (`run`, `getRun`), the pg-boss worker
for the one `agentRun` queue (and its `jobs.registry.ts` entry with
`maxConcurrent`), run state and resume, the shape hash, and binds
`AGENT_RUNTIME` in `agents.module.ts`. Without a binding,
`AgentsService` throws.

- `onArtifact` takes whatever the last stage returned: it parses the
  artifact and the input itself.
- `options.judgeReplay` is stored on the run and bound per run
  (`AgentPageReplayService`), never process-wide.
- `AgentsModule` imports `AgentToolsModule`. Call
  `AgentWebService.endRun(runId)` when a run ends (see `tools/AGENTS.md`).
- Wrap a run in `withAgentRun({ runId, agent, shapeHash }, fn)`, each stage
  in `withStageSpan`, and each tool with `instrumentTool`. The span
  processor in `otel.ts` stamps `gen_ai.conversation.id` and
  `agento11y.record=true` on every span inside the run. Prompt and reply
  text are never set.

## Grafana Agent Observability

Two ways in, per Grafana's docs. This base uses the second.

- **The SDK**, `@grafana/agento11y` (0.16, ESM only, framework
  integrations at `/vercel-ai-sdk` and `/langgraph`). It exports
  generations to its own endpoint and needs new credentials
  (`AGENTO11Y_ENDPOINT`, `AGENTO11Y_AUTH_TENANT_ID`, and an access policy
  token with the `sigil:write` scope). It pulls in about 580 MB of
  framework dependencies (OpenAI, LlamaIndex, Google ADK, LangGraph), so it
  is not installed here.
- **OTLP** (public preview), what this uses. Spans with `gen_ai.*`
  attributes and `agento11y.record=true` go out through `otel.ts`'s existing
  exporter and token. `agentRunSpanProcessor` sets the run's conversation
  id, agent name and version (the shape hash), and names AI SDK provider
  calls as `chat` generations. No prompt or reply text is set, as in chat
  today.

Before anything shows up, a Grafana Cloud admin has to enable Agent
Observability on the stack (Observability > Agent Observability, accept the
terms). Engines wrap chat turns in `withAgentRun` too, with the conversation
id as the run id.

## Meeting briefing

`findAgenda` (webSearch, fetchPage, checkLink) → `readPacket` (readDocument,
searchDocument, officialPriorities) → `writeBriefing` (queryVoters,
webSearch, fetchPage, checkLink). `findAgenda` routes straight to
`writeBriefing` when it found no packet, which then returns the placeholder,
so every run ends in a schema-valid `MeetingBriefingSchema`.
`meetingBriefingSingleStage` runs the whole instruction as one stage for
parity runs.

Input: `MeetingBriefingsService.buildAgentBriefingInput` builds it the way
`dispatchBriefing` builds today's params, plus `organizationSlug`,
`electedOfficeId` and `requestedAt` (the model has no clock).
`onArtifact` calls `MeetingBriefingsService.saveAgentBriefing`: the row
carries the artifact in `MeetingBriefing.artifact` with no ExperimentRun and
no S3 pointer, and the briefing route, PDF and briefing chat read that
column before S3.

`queryVoters` cannot use `src/peopleDb`: `mart_gp_api.gp_api_voters` has no
`hs_*` columns. It reads the Chief of Staff's approved mart with the
`DATABRICKS_*` credential, fixed aggregate SQL only, and the same 100-person
cell floor. Two catalog columns (`hs_ideology_fiscal_*`) are not in that
mart and are dropped from the prompts.

## Dev tools

All three run from the build against `DATABASE_URL`:

```bash
npm run poc:agent -w packages/gp-api -- start <electedOfficeId> [meetingDate]
npm run poc:agent -w packages/gp-api -- view <runId> [--watch]
npm run poc:agent -w packages/gp-api -- work
npm run poc:kill-test -w packages/gp-api -- <electedOfficeId> [meetingDate] [--change-shape] [--hard]
```

`start` and `view` work no queue (`JOBS_WORKERS=off`); `work` works only
`agentRun`, so a laptop pointed at a shared database is never a worker for
anything else. The kill test kills the worker once `readPacket` has saved
two steps (SIGTERM, or SIGKILL with `--hard`), starts another, and passes
when the run resumes (or, with `--change-shape`, starts over under a new
shape hash). It edits `PacketNotesSchema` and rebuilds for the second worker,
then restores both.

## Judge

`JUDGE_BACKGROUND_RUNTIME=inprocess` runs a background candidate inside the
arm's own app (`runners/backgroundInProcess.ts`); the base arm stays the
Fargate dispatch. `meeting_briefing` now records pages on the base arm, and
the candidate passes the same replay ticket through `judgeReplay`.
`JUDGE_INPROCESS_SINGLE_STAGE=true` judges the single-stage agent instead.
Cases with staged `inputFiles` are refused (no `/workspace` here), and the
record carries the engine's cost but no token counts.
