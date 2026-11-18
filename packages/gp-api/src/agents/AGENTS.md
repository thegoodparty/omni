# Agents

Background agents that run inside gp-api on the Vercel AI SDK. An agent is
one prompt, one model, its tools and an output schema. A run is one long
conversation: no stages. Chat agents stay on `src/chats` for now.

## Key files

| Path                        | What                                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------------------ |
| `agents.registry.ts`        | `AGENTS`: every agent by name. The name is the run's `agentName`                                 |
| `defineAgent.ts`            | `AgentDefinition` and `defineAgent`                                                              |
| `agents.service.ts`         | `AgentsService.run(name, input)` and the `agentRun` worker                                       |
| `aiSdkLoop.ts`              | The loop: `streamText`, a row per step, `submitOutput`, nudges, budget                           |
| `manifest.ts`               | The run's manifest (input and output schema) and its `shapeHash`                                 |
| `agentMessages.ts`          | `AgentMessage` rows ↔ the AI SDK's messages, both ways                                           |
| `agentRunSpans.ts`          | Grafana Agent Observability attributes and spans (`otel.ts` loads it)                            |
| `agentModels.ts`            | Model id to provider model; tests swap in a mock model here                                      |
| `tools/tool.ts`             | `AgentTool`, `defineTool` and `ToolContext`                                                      |
| `tools/webSearch.ts`        | Brave web search: ranked result URLs with titles and snippets                                    |
| `tools/fetchPage.ts`        | A web page as markdown, 10,000 characters a call (`offset` reads on), and its own published date |
| `tools/checkLink.ts`        | HEAD status and final URL                                                                        |
| `tools/agentWeb.service.ts` | Plain HTTP behind the private-address guard, on every redirect hop                               |
| `tools/judgeReplay.ts`      | Serves the judge's recorded pages to a judge run                                                 |
| `tools/queryDatabricks.ts`  | `databricksTool({ tables, maxRows, dimensions, scope })`: one scoped, aggregate-only read off the manifest scope |

Agents live with their product: `trending_issues` is
`src/communityIssues/trendingIssuesAgent/`.

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

## Web tools

`webSearch` is Brave Web Search, the endpoint and `BRAVE_API_KEY` the
ordinance flow already uses. The key is read at call time, so a missing key
is a tool result the model can work around rather than a boot failure. It is
the only search an agent gets: there is no provider-side web search, which
hands back opaque content the agent could not fetch and therefore could not
check a claim against. Its results are URLs and snippets only — a candidate
to read, never a source.

`fetchPage` and `checkLink` go through `AgentWebService`: plain HTTP, no
browser, 10 MB at most, five redirects, 30 seconds a request start to end. Redirects are followed by hand so
every hop is checked before it is requested: its URL (http or https, no
private or loopback IP literal, no `localhost`), and the address its
hostname resolves to, by `ssrfSafeLookup` when the connection opens.
`fetchPage` reads HTML and text; a PDF, a Word file or a page that needs
JavaScript comes back as a failure value. It also returns the page's own
`published` date, read from `article:published_time` and its kin, then
`<time datetime>`, then JSON-LD — an agent that has to put a source inside a
window dates it from the page, never from a search snippet. Failures are
values, never throws, so one bad URL does not end a run.

## Databricks

`databricksTool` stands in for the PMF Engine broker's Databricks scope. Each
agent builds its own, with the table allowlist and row cap from its manifest's
`scope` block, so the grant lives in the definition and not in the model's
hands:

```ts
tools: {
  queryDatabricks: databricksTool({
    tables: ['goodparty_data_catalog.dbt.int__l2_nationwide_uniform_w_haystaq'],
    maxRows: 50_000,
    dimensions: ['Active'],
    scope: orgDatabricksScope,
  }),
}
```

`tables` may also be a resolver — `async (ctx) => string[]` — for an agent whose
table is not fixed by its definition but chosen per run, as the people marts
are (`PeopleDatasetService` picks `gp_api_voters` or `gp_api_constituents` per
org). The resolver runs once per query and an empty list refuses every query;
the description then says "the table named in your input" rather than listing
one, because a table the run chooses cannot be named at definition time. Put
the chosen name in the run's input so the model reads it from its first message,
and have the resolver read it back from the stored `AgentRun.input` by
`ctx.runId` — never from anything the model sends in a tool call.

- **Aggregate-only, on the constituent-data tool's rules.** The chat tools
  (`query_constituent_data`, `district_insights`) hold model-written voter SQL to
  `validateConstituentSql`; this tool runs the same shape checks per SELECT, from
  the same functions. Every select item is an allowlisted aggregate
  (`COUNT`, `SUM`, `AVG`, `MIN`, `MAX`, `APPROX_COUNT_DISTINCT`), a literal, or a
  GROUP BY column; `SELECT *`, `DISTINCT`, window functions, a scalar function,
  `COUNT(DISTINCT …)` and an aggregate wrapped in arithmetic are all refused. The
  broker never enforced any of this, so a query here could otherwise have
  selected `LALVOTERID` and its `hs_*` scores 50,000 rows deep.
- **`dimensions` is the groupable-column allowlist.** A GROUP BY may name only
  these, and `assertAggregateSelectShape` accepts a bare column only when it is
  in that same set, so a row identifier (`LALVOTERID`) can be neither selected nor
  grouped. An agent lists the coarse dimensions it reasons about — `Active`
  and the like — and nothing row-level. The scope's own jurisdiction columns
  (the state, and the office's L2 district column) are groupable without being
  declared, because their name comes from the run rather than the definition.
- **A COUNT(*) and a cell-size floor.** Every SELECT that reads the table must
  carry a bare, unfiltered `COUNT(*)`, and `scrubResults` drops each result row
  whose `COUNT(*)` is below `minCellSize` (default 100, the
  `CONSTITUENT_MIN_CELL_SIZE` the chat tools use) and nulls any other count-like
  value below it. The floor also contains a predicate on an identifier: a query
  that adds `LALVOTERID = '…'` returns a group of one, and a group of one is
  dropped. `suppressed` reports how many rows the floor removed.
- **Every SELECT, not just the outer one.** The shape check and the floor's
  `COUNT(*)` run on each SELECT the walk finds — the outer query, each UNION
  branch, each derived table — because a row read in a branch is exactly what the
  outer aggregate hides. A statement with a CTE is refused before that (see
  below).

- **One read-only SELECT, parsed.** Not a regex: the statement goes through
  `parseSingleSelect`, every SELECT at any depth is walked (the outer one, each
  UNION branch, each subquery), and a write node anywhere — `INSERT`, `UPDATE`,
  `DELETE`, `MERGE`, DDL, or `SELECT INTO` — is rejected. Two statements after a
  semicolon, a table function in `FROM`, and a query the parser cannot read are
  all refused, never passed through. A comment or a backslash is refused
  outright: both are decided purely by the parser's lexical rules, the parser
  here is not the one that runs the statement, and a statement that proves a
  filter here but lexes differently in Spark could have that filter removed. A
  statement with a CTE is refused too: a
  CTE name can mean the CTE in one place and a real table in another (a
  non-recursive CTE cannot see itself, and a reference outside its WITH is the
  real table), and there is no Spark binder here to resolve that. Use a derived
  table in `FROM`, which has no name to resolve.
- **The allowlist is the manifest's.** A table reference must resolve to exactly
  the allowed name — catalog, schema and all. A bare or partly-qualified name
  resolves against the statement client's pinned default
  (`goodparty_data_catalog.mart_gp_api`), which is a different table from the
  `dbt` one the manifest grants, so it is refused rather than accepted as
  shorthand; a spoofed `evil.public.<t>` matches nothing.
- **One relation per SELECT.** `assertScope` proves the filter over the WHERE,
  and a second relation would let a predicate qualified to it stand in as proof
  for the table (`JOIN (SELECT 'IL' AS Residence_Addresses_State) d … WHERE
  d.Residence_Addresses_State = 'IL'`), so a SELECT that reads the table may
  have nothing else in its `FROM`. A self-join hits the same rule.
- **The run's jurisdiction is not the model's to choose.** `scope` resolves it
  from `ctx.organizationSlug` through `orgDatabricksScope` — the org's elected
  office and `OrganizationsService.resolveServeContext`, the same source
  `communityIssueDispatch.service.ts` builds a run's `state` and `l2_*` params
  from. Every SELECT that reads an allowed table must prove its own
  `Residence_Addresses_State = '<state>'` (and `'<L2 column>' = '<district>'`
  when the office has one) in its WHERE, and that column must be unqualified or
  qualified to that table's own alias — a predicate belonging to another
  relation is not proof. A query with no filter, another state's, one qualified
  elsewhere, or an OR that steps around it is rejected with the clause to add.
  An org with no jurisdiction gets `no_scope` and no query runs. A scope value
  that itself contains a single quote is refused: Spark reads `''` as two
  adjacent literals, not an escaped quote, so that value cannot be written in a
  query at all and a query naming it would match nothing.
- **Nothing is rewritten.** gp-api has no Spark re-emitter it can trust (Spark
  reads a double-quoted identifier as a string), so the model writes the filter
  itself and the tool proves it rather than splicing SQL.
- The row cap is applied at the warehouse: the statement carries
  `row_limit: maxRows + 1`, so the extra row proves there was more without this
  process holding every match first. The result is then cut at `maxRows` with
  `truncated: true`. Every refusal is a value
  the model reads and corrects — `rejected` with the fix, `no_scope`,
  `query_failed` with the warehouse's message, `timeout` — so one bad query
  never ends a run. The only throw is the run's own `signal` aborting, which
  means the loop is going down.
- It runs on `ctx.get(PeopleDbxStatementClient)`, the same Statement Execution
  client the voter reads use, and passes its own signal so a statement that
  never settles still stops at `statementTimeoutMs` (30s default) and is
  cancelled at the warehouse.

## Moving a PMF Engine agent here

`trending_issues` is the template:

1. Register it in `AGENTS` under its experiment id, so every reader and gate
   that queries the PMF Engine's `ExperimentRun` rows of that `experimentType`
   can be pointed at `AgentRun` rows of that `agentName` (see
   `communityIssueRead.service.ts` and
   `communityIssueDispatch.service.ts` for the ones that have been). A gate
   left on the old table is a duplicate-dispatch bug: it sees no runs and lets
   the type run again.
2. The prompt is the experiment's `instruction.md` with the runtime parts
   swapped: input in the first message, our tools, `submitOutput` instead of
   the file and validator. Input and output schemas come from the manifest;
   leave out fields gp-api knows (the run id) and add them in `onArtifact`.
3. `onArtifact` calls the code that ingests the PMF Engine's artifact today.
4. The dispatcher calls `AgentsService.run` when `runsOnGpApi(name)`: the
   experiment ids in `AGENTS_ON_GP_API`, comma-separated. Unset means the
   PMF Engine, so the switch flips per environment. Keep the test-user and
   test-mode check `ExperimentRunsService.dispatchRun` makes; `run` does not
   make it.
5. Add it to `IN_PROCESS_AGENTS` in the judge
   (`src/chats/evals/judge/runners/backgroundInProcess.ts`): its candidate
   arm then runs on gp-api against the PMF Engine's base arm.

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
- `run(name, input, { judgeReplay })` is for the judge's candidate arm only.
  The ticket rides on the `agentRun` job (and onto a superseding run's), and
  reaches tools as `ctx.judgeReplay`.
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
