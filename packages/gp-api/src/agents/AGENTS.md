# Agents

Background agents that run inside gp-api on the Vercel AI SDK. An agent is
one prompt, one model, its tools and an output schema. A run is one long
conversation: no stages. Chat agents stay on `src/chats` for now.

## Key files

| Path                 | What                                                                   |
| -------------------- | ---------------------------------------------------------------------- |
| `agents.registry.ts` | `AGENTS`: every agent by name. The name is the run's `agentName`       |
| `defineAgent.ts`     | `AgentDefinition` and `defineAgent`                                    |
| `agents.service.ts`  | `AgentsService.run(name, input)` and the `agentRun` worker             |
| `aiSdkLoop.ts`       | The loop: `streamText`, a row per step, `submitOutput`, nudges, budget |
| `manifest.ts`        | The run's manifest (input and output schema) and its `shapeHash`       |
| `agentMessages.ts`   | `AgentMessage` rows ↔ the AI SDK's messages, both ways                 |
| `agentRunSpans.ts`   | Grafana Agent Observability attributes and spans (`otel.ts` loads it)  |
| `agentModels.ts`     | Model id to provider model; tests swap in a mock model here            |
| `tools/tool.ts`      | `AgentTool`, `defineTool` and `ToolContext`                            |
| `tools/webSearch.ts` | Brave web search, the one web tool every agent shares                  |

## Adding an agent

```ts
// agents.registry.ts
export const AGENTS: Record<string, AgentDefinition> = {
  myAgent: defineAgent({
    input: z.object({ organizationSlug: z.string(), topic: z.string() }),
    output: MyOutputSchema,
    model: 'claude-sonnet-4-6',
    prompt: MY_PROMPT,
    tools: { webSearch, fetchPage },
    onArtifact: (artifact, run, { get }) =>
      get(MyService).save(artifact, run.runId),
  }),
}

await agentsService.run('myAgent', { organizationSlug, topic })
```

- `input` must carry `organizationSlug`: it owns the run. It is stored as
  JSON, so use JSON types (no `z.date()`).
- `tools` is a map keyed by tool name, as the AI SDK takes them. Build each
  one with `defineTool({ description, input, execute })`: `execute`'s input
  is inferred from `input`, and its second argument is the `ToolContext`.
- `output` is enforced when the model calls `submitOutput`. A miss returns
  Zod's list of what is wrong, not the whole input, and the model retries.
- `onArtifact` saves the validated output where the product reads it. It
  can run twice for one run (a crash after it, before the run is marked
  complete), so make it an upsert.
- A tool's `execute` gets `ToolContext`: `runId`, `stepKey` (stable across a
  resume of the same step, so key a write on `runId + stepKey`),
  `organizationSlug`, `signal` and `get` (any provider, as in a job worker).

## How a run works

- `run()` validates the input and, in one transaction, creates the
  `AgentRun` (`agentName`, `organizationSlug`, status `queued`, `manifest`
  and its `shapeHash`, `input`) with the input as its first `AgentMessage`
  row, then sends the `agentRun` job.
- The `agentRun` job (one queue for every agent, `maxConcurrent: 10`
  fleet-wide, 120-minute attempts, 5 attempts) loads the run's messages and
  calls the loop. Every message the loop writes is one `AgentMessage` row, in
  order: the assistant message (its text and tool calls) and, when tools ran,
  the tool message holding their results. Only assistant rows carry the model
  and its four token counts, because only they are a model call.
- A retry loads those rows and calls the loop again. Only completed steps are
  saved; a step in flight is redone.
- A deploy aborts the job's signal with `JobShutdownError`: the loop stops
  after its current step and the job is requeued without spending an
  attempt. pg-boss's timeout aborts model and tool calls at once.
- Shape: `manifest` is the agent's input and output schemas at run start, and
  `shapeHash` hashes it. If a retry finds a different hash, the run is marked
  `superseded` and a fresh run with the same input starts. Prompts, tools and
  models change freely.
- The step budget is 120 steps per run across all attempts.
- Ending: `completed` after `onArtifact`, or `failed` with `error` on the last
  attempt. A failure is surfaced by the `agentRun` queue's dead-letter and
  backed-up alerts; there is no separate output-failure metric.
- No cost is stored. Tokens live on the assistant rows and Grafana Agent
  Observability prices the calls; later analysis prices the stored tokens.

## Observability

Each attempt runs under an `invoke_agent <name>` span; each tool under
`execute_tool <name>`. `agentRunSpanProcessor` stamps
`gen_ai.conversation.id` (the run id), `gen_ai.agent.name`,
`gen_ai.agent.version` (the shape hash) and `agento11y.record=true` on
every span inside the run, the AI SDK's model-call spans included, for
Grafana Agent Observability's OTLP path. Prompt and reply text are never
recorded.

## Tests

`agents.service.test.ts` is the pattern: register a test agent in `AGENTS`
for the file (and delete it after), `vi.spyOn(AgentModels, 'resolve')` to
return a `MockLanguageModelV3`, call `AgentsService.run`, then
`service.jobs.settle()` and assert on the rows.
`agents.service.shutdown.test.ts` stops a stand-in gp-api task mid-run to
prove a deploy stops the run after its current step.
