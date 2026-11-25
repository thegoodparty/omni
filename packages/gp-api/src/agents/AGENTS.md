# Agents

Background agents that run inside gp-api on the Vercel AI SDK. An agent is
one prompt, one model, its tools and an output schema. A run is one long
conversation: no stages. Chat agents stay on `src/chats` for now.

## Key files

| Path                            | What                                                                                                             |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `agents.registry.ts`            | `AGENTS`: every agent by name. The name is the run's `agentName`                                                 |
| `defineAgent.ts`                | `AgentDefinition` and `defineAgent`                                                                              |
| `agents.service.ts`             | `AgentsService.run(name, input)` and the `agentRun` worker                                                       |
| `aiSdkLoop.ts`                  | The loop: `streamText`, a row per step, `submitOutput`, nudges, budget                                           |
| `manifest.ts`                   | The run's manifest (input and output schema) and its `shapeHash`                                                 |
| `agentMessages.ts`              | `AgentMessage` rows ↔ the AI SDK's messages, both ways                                                           |
| `agentRunSpans.ts`              | Grafana Agent Observability attributes and spans (`otel.ts` loads it)                                            |
| `agentModels.ts`                | Model id to provider model; tests swap in a mock model here                                                      |
| `tools/tool.ts`                 | `AgentTool`, `defineTool` and `ToolContext`                                                                      |
| `tools/webSearch.ts`            | Brave web search: ranked result URLs with titles and snippets                                                    |
| `tools/fetchPage.ts`            | A web page as markdown, 10,000 characters a call (`offset` reads on), and its own published date                 |
| `tools/checkLink.ts`            | HEAD status and final URL                                                                                        |
| `tools/renderPage.ts`           | Last resort: a page in an AgentCore managed browser, as markdown (10,000 characters), five a run                 |
| `tools/agentBrowser.service.ts` | One AgentCore Browser session per render, stopped every time; one at a time and five a run                       |
| `tools/agentWeb.service.ts`     | Plain HTTP behind the private-address guard, on every redirect hop                                               |
| `tools/queryDatabricks.ts`      | `databricksTool({ tables, maxRows, dimensions, scope })`: one scoped, aggregate-only read off the manifest scope |
| `agentRunRoutes.controller.ts`  | `POST /v1/agents/:name/runs`, `GET /v1/agents/runs/:runId` — the judge's door, dev and previews only            |

Agents live with their product: `trending_issues` is
`src/communityIssues/trendingIssuesAgent/`, `top_community_issues` is
`src/communityIssues/topCommunityIssuesAgent/`, `meeting_schedule` is
`src/meetings/meetingScheduleAgent/`, `opposition_research` is
`src/campaignStrategy/oppositionResearch/`, and `opportunities_and_challenges`
is `src/campaignStrategy/opportunitiesAndChallengesAgent/`.

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
- **An agent that reads the warehouse cannot submit an output no successful
  query backs.** A tool built with `readsWarehouse: true` (only
  `queryDatabricks` is) makes `submitOutput` refuse while the run has had no
  query come back `ok`, because a schema-valid artifact is exactly what a
  model invents when the warehouse was unreachable. This is the PMF Engine
  broker's `NoDataQueriesSucceeded` gate, moved to the engine. The escape is
  the manifest's own carve-out, declared as `dataRequiredUnless`: an output
  whose named field carries one of the listed values is not claiming data,
  so the gate does not apply. `top_community_issues` declares
  `data_quality: insufficient_signal`, as its manifest's
  `scope.data_required_unless` does.
- `onArtifact` saves the validated output where the product reads it. It
  can run twice for one run (a crash after it, before the run is marked
  complete), so make it an upsert. It also runs BEFORE the run is marked
  complete, so a re-chain it triggers still sees its own row as `running`: an
  in-flight dedup has to exclude `run.runId`.
- `onFailure` is optional and runs only when the run ends `failed` — the last
  attempt threw and it was not a deploy shutdown — after the row says so. An
  agent whose product chains off its completion needs it, or a failed link
  leaves the next one waiting on a run that never lands. It gets
  `{ runId, input, error }`, and a hook that throws is logged without changing
  the failed row.
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

`renderPage` is the last resort for a page `fetchPage` could not read (403,
401, a bot check, no readable text), as the PMF Engine's Chromium render was.
`AgentBrowserService` opens an AgentCore Browser session on the managed
`aws.browser.v1` for each render and stops it in a `finally`, whatever
happened. A run's renders queue, so it holds one session at a time, and it
gets five (`MAX_RENDERS_PER_RUN`, counted in the process). Every document
request the rendered page's target makes, each redirect hop included, is
paused over CDP (`Fetch.enable`) and refused unless its URL passes
`fetchPage`'s checks and its hostname resolves to public addresses only.
Popups, out-of-process frames and the page's own XHRs are not intercepted,
and the browser does its own DNS lookup; that is acceptable because the
browser runs in AWS's network, not gp-api's, and only the page's text comes
back. The final URL is checked
again. The page is cut at 10 MB and the render ends at 60 seconds or on
`ctx.signal`. Failures are values (`blocked_host`, `render_limit`, `timeout`,
`browser_unavailable`, `http_error`, `no_text`, ...), and each one is the
`error.type` of its `execute_tool` span like any other tool's. The task
role's grant is in `deploy/index.ts`. `renderPage.live.test.ts` renders real
pages under `gp-engineer` when `RENDER_PAGE_LIVE=1`.

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
the description then says "the table this organization reads" rather than
listing one, because a table the run chooses cannot be named at definition
time. Resolve it from `ctx.organizationSlug` through the service that owns the
choice, as `topCommunityIssuesDatabricksTables` does — never from anything the
model sends in a tool call, and never from a field a caller has to remember to
pass, because then one caller that forgets starts runs no query can serve.

- **Aggregate-only, on the constituent-data tool's rules.** The chat tools
  (`query_constituent_data`, `district_insights`) hold model-written voter SQL to
  `validateConstituentSql`; this tool runs the same shape checks per SELECT, from
  the same functions. Every select item is an allowlisted aggregate
  (`COUNT`, `SUM`, `AVG`, `APPROX_COUNT_DISTINCT`), a literal, or a
  GROUP BY column; `MIN` and `MAX` are refused here, because each returns one
  row's own value (`MAX(LALVOTERID)` is a voter ID); `SELECT *`, `DISTINCT`, window functions, a scalar function,
  `COUNT(DISTINCT …)` and an aggregate wrapped in arithmetic are all refused. The
  broker never enforced any of this, so a query here could otherwise have
  selected `LALVOTERID` and its `hs_*` scores 50,000 rows deep.
- **`dimensions` is the slicing allowlist.** A GROUP BY may name only these, a
  bare select item is accepted only when it is in that same set, and every column
  a `WHERE` or `HAVING` names must be one of them too — so a row identifier
  (`LALVOTERID`) can be neither selected, grouped nor filtered on. That last one
  is the differencing control the floor cannot be: `AND LALVOTERID <> 'x'` leaves
  both cells far above the floor and the difference between them is one
  person's score. An aggregate's own argument (`AVG(hs_x)`) is unrestricted,
  because that is what the aggregate is for and the floor holds its result, but
  it must be one plain column or `*`: a CASE or comparison inside an aggregate
  (`AVG(CASE WHEN LALVOTERID = 'x' THEN hs_x END)`) is a filter of its own. The
  one exception is `SUM(CASE WHEN <condition> THEN 1 ELSE 0 END)`, which is a
  count of people rather than a way around the floor: the constituent-data
  tools' own `sumCountsPeople` decides it, and only a `CASE` whose every branch
  yields `1`, `0` or `NULL` passes. `SUM(hs_x)`, `SUM(CASE WHEN … THEN hs_x
  END)` and `COUNT_IF` are refused. A `SUM` that passes is held to the floor as
  a count of people, because `findPeopleCountColumns` names its column and
  `scrubResults` masks it below `minCellSize` exactly as it masks a `COUNT`. An
  agent lists the coarse dimensions it reasons about — `Active` and the like —
  and nothing row-level. The scope's own jurisdiction columns (the state, and the
  office's L2 district column) are sliceable without being declared, because
  their name comes from the run rather than the definition.
- **A COUNT(\*) and a cell-size floor.** Every SELECT that reads the table must
  carry a bare, unfiltered `COUNT(*)`, and `scrubResults` drops each result row
  whose `COUNT(*)` is below `minCellSize` (default 100, the
  `CONSTITUENT_MIN_CELL_SIZE` the chat tools use) and nulls any other count-like
  value below it. `suppressed` reports how many rows the floor removed.
  `truncated` is true when either the raw page or the surviving rows exceed
  `maxRows`, because the warehouse cuts the page at `maxRows + 1` and the floor
  can eat that extra row; only the second count would report a partial result as
  complete.
- **One flat SELECT.** A UNION or other set operation, a subquery anywhere
  (FROM, WHERE, the select list) and a CTE are all refused, as the chat tools
  refuse them: the floor reads only the outer result's own `COUNT(*)` column, so
  a nested cell — a UNION branch that moves its count, an outer aggregate over a
  derived table — is one the floor never sees.

- **One read-only SELECT, parsed.** Not a regex: the statement goes through
  `parseSingleSelect`, every SELECT at any depth is walked (the outer one, each
  UNION branch, each subquery, before refusing the nesting), and a write node anywhere — `INSERT`, `UPDATE`,
  `DELETE`, `MERGE`, DDL, or `SELECT INTO` — is rejected. Two statements after a
  semicolon, a table function in `FROM`, and a query the parser cannot read are
  all refused, never passed through. A comment or a backslash is refused
  outright: both are decided purely by the parser's lexical rules, the parser
  here is not the one that runs the statement, and a statement that proves a
  filter here but lexes differently in Spark could have that filter removed. A
  statement with a CTE is refused too: a
  CTE name can mean the CTE in one place and a real table in another (a
  non-recursive CTE cannot see itself, and a reference outside its WITH is the
  real table), and there is no Spark binder here to resolve that.
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
- **A scope can come from the run's stored input instead.**
  `top_community_issues` passes `topCommunityIssuesDatabricksScope`, which
  reads `AgentRun.input` by `ctx.runId` (never anything the model sends). The
  dispatcher built that input from the same `resolveServeContext`, so in
  production the two agree (a test holds them equal), and a judge run is
  scoped to its own test user's district. It fails
  closed: no state or half an L2 pair is `no_scope`.
- **The table must be one gp-api's principal can read**: `mart_gp_api`, the
  schema with a grant that survives a dbt rebuild. A manifest's `dbt.*` table
  gets a mart view first, and where the table varies by org the tool resolves
  it from the run's org (`top_community_issues` reads the org's own people
  mart).
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
   has one that queries `AgentRun` rows of that `agentName` (see
   `communityIssueRead.service.ts` and
   `communityIssueDispatch.service.ts` for two that have been). A gate left on
   the old table is a duplicate-dispatch bug: it sees no runs and lets the type
   run again.
   - Those readers pick one table from `runsOnGpApi`, which makes the flip
     atomic. A migration's rollback is reverting its list lines, and that
     restores the old engine only if its readers can read that engine's runs.
     One that reads a single table cannot: a gate asks which run this org
     already has by org, agent type and status, and a run the other engine
     stored is invisible, so after a revert the gate dispatches a second one.
     `meeting_schedule`'s gate and latest-schedule read
     (`meetingBriefings.service.ts`) are that shape on main today.
   - So a migrating agent's readers are two-way first: the gate and the
     latest-run read query both `AgentRun` and `ExperimentRun` by org and agent
     type, and a read by id falls through to the other table, as
     `agentRunRoutes.service.ts`'s `read` does. This is the one place a
     migration departs from the readers already in, it belongs to the migration
     PR, and nothing checks it — the judge verdict never tests a revert.
2. The prompt is the experiment's `instruction.md` with the runtime parts
   swapped: input in the first message, our tools, `submitOutput` instead of
   the file and validator. Input and output schemas come from the manifest;
   leave out fields gp-api knows (the run id) and add them in `onArtifact`.
3. `onArtifact` calls the code that ingests the PMF Engine's artifact today.
4. The dispatcher calls `AgentsService.run` when `runsOnGpApi(name)`: the
   experiment ids in `AGENTS_ON_GP_API`, comma-separated, which
   `deploy/agentsOnGpApi.ts` sets per environment (`preview`, `dev`, `prod`).
   Unset means the PMF Engine, so the switch is per environment. Keep the
   test-user and test-mode check `ExperimentRunsService.dispatchRun` makes;
   `run` does not make it.
5. Add it to all three lists in `deploy/agentsOnGpApi.ts` in the same PR, with
   the agent, its readers and its judge suite — one PR is the whole migration.
   While that PR is open, dev runs `main`'s lists, so its `/judge-eval` reads
   the PMF Engine on the base arm and gp-api's engine on the preview; that
   verdict is the proof. Add a pairwise migration suite. See
   [Writing agent evals](../../../../docs/agent-evals.md).
6. Delete its `qa/` manifest under `packages/runbooks/experiments/`. QA
   checkers are not migrated.

## How a run works

- `run()` validates the input and, in one transaction, creates the
  `AgentRun` (`agentName`, `organizationSlug`, status `queued`, `manifest`
  and its `shapeHash`, `input`) with the input as its first `AgentMessage`
  row, then sends the `agentRun` job.
- The `agentRun` job (one queue for every agent, capped at 100 running
  runs fleet-wide, with this many slots on every task too, so the cap alone
  decides; 120-minute attempts, 5 attempts) loads the run's messages and
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
`execute_tool <name>`, following the OTel GenAI `gen_ai.execute_tool` span's
[Recording Errors](https://github.com/open-telemetry/semantic-conventions/blob/v1.45.0/docs/general/recording-errors.md)
rule: a tool that failed — returned `ok:false` or threw — sets status `ERROR`
and `error.type` to its code (`rejected`, `timeout`, `http_error`, ...),
`schema` or `no_data` for a refused `submitOutput`, `thrown` for a throw, and
`_OTHER` (that attribute's documented fallback) when there is no clean code.
A tool that worked sets neither, so its span reads `UNSET`. `error.type` is a
code and nothing else: a tool's reason field can be a URL, SQL or a message,
so a value that is not already a `[a-z0-9_]` code becomes `_OTHER`.
`agentRunSpanProcessor` stamps
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

## Reading a run from staff tooling

`admin/background-agent-runs` (`src/admin/backgroundAgentRuns`, `M2MOnly`) is
the read-only admin surface for these runs, and gp-admin's "Agent Run" page is
its one consumer. `GET /v1/admin/background-agent-runs` lists runs newest
first, filtered by `agentName`, `status`, `organizationSlug`, `createdAfter`
and `createdBefore`, paginated with `limit`/`offset`; duration is derived from
`startedAt`/`finishedAt` at read time. `GET /v1/admin/background-agent-runs/:runId`
returns the run plus its `AgentMessage` rows in `index` order, each with its
`parts` and, on assistant rows, the model and its four token counts. There is
no retry: re-running an agent from here would bypass the dispatcher's gates.
`admin/agent-runs` next door is the PMF Engine's `ExperimentRun` and does not
read this table. The shapes are in contracts `backgroundAgentRuns/`.

## The judge's run routes

`agentRunRoutes.controller.ts` is the only HTTP way to start any background
agent, on whichever engine will run it
([`docs/adr/2026-11-19-the-judge-reaches-agents-only-through-a-base-url.md`](../../../docs/adr/2026-11-19-the-judge-reaches-agents-only-through-a-base-url.md)).
The Universal Judge holds a base URL and a signed-in user and nothing else, and
these are the two routes it calls:

```
POST /v1/agents/:name/runs   { input }  -> { runId }
GET  /v1/agents/runs/:runId             -> { status, artifact, error }
```

- **Dev and previews only.** Both 404 on prod and qa
  (`isDevOnlyRouteEnabled`), the same gate as the community-issues seed.
- **The caller must belong to the org the input names.** Owner or membership,
  resolved the way `UseOrganizationGuard` resolves it; anyone else gets that
  guard's 404.
- **`POST` dispatches through `runsOnGpApi`**, the product's own per-agent
  switch: gp-api's agents when it is on, `ExperimentRunsService.dispatchRun`
  otherwise. It is the one caller that passes `allowTestUser: true`, because
  every judge run brings a new `@test.goodparty.org` user the product's
  dispatch guard would refuse. A preview names every agent in the registry in
  `AGENTS_ON_GP_API` (`deploy/agentsOnGpApi.ts`), so the candidate arm really
  runs gp-api's engine.
- **`GET` returns the artifact the same way from both.** An `AgentRun` keeps
  its artifact in the row; an `ExperimentRun` keeps S3 coordinates and the row
  is read through `S3Service.getFile`. `AWAITING_RESUME` reads as `failed`,
  because a judge run is never resumed: the resume loop re-dispatches through
  the test-user guard that only `POST` bypasses, so a parked judge run can only
  cycle the sweep until `MAX_RESUME_ATTEMPTS` fails it. The error says so.
- **`compliance_setup` is refused by name**: it buys domains and submits to
  Peerly, so a judge run of it spends real money.
- **A suite writes one input, in the manifest's snake_case shape**, which is
  the shape every agent has. The route converts the keys to gp-api's
  camelCase when it dispatches to gp-api and fills `today` when the definition
  requires it. That conversion is the only place the two engines' vocabularies
  meet, and it goes away with the PMF Engine.
- **Nothing here reads a run's messages.** The judge grades the artifact; a
  transcript would be a second read route.
