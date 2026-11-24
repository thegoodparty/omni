# communityIssues

Serve-side community-issues feature. Ingests a ranked list of civic issues
from an AI experiment run, surfaces them to elected officials, and lets them
prioritize issues into their elected-office priority list.

This module is the consolidation of two earlier ones: the dead campaign-side
constituent-issue tracker (deleted, it had no consumers) and the Serve issue
feed that was briefly named with a "Feed" suffix to avoid the collision —
renamed onto this clean name once the dead module was removed.

## Key files

| File                                           | Purpose                                                        |
| ---------------------------------------------- | -------------------------------------------------------------- |
| `communityIssues.module.ts`                    | NestJS module; exports nothing (consumers import the module)   |
| `controllers/communityIssues.controller.ts`    | HTTP routes under `/v1/community-issues`                       |
| `schemas/communityIssues.schema.ts`            | Zod DTOs and response schemas                                  |
| `services/communityIssue.service.ts`           | Root service; handles `onExperimentRunCompleted`               |
| `services/communityIssueUpsert.service.ts`     | Upsert logic for artifact rows                                 |
| `services/communityIssueRead.service.ts`       | Read queries (list, detail)                                    |
| `services/communityIssuePrioritize.service.ts` | Prioritize / de-prioritize an issue                            |
| `services/communityIssueDispatch.service.ts`   | Dispatch AI experiment runs per org slug (cohort + self-serve) |
| `services/communityIssueSeed.service.ts`       | Preview/dev-only deterministic seeding for e2e tests           |
| `services/communityIssueStarter.service.ts`    | Quick starter top list for Serve onboarding (Gemini + search)  |
| `communityIssueBucketing.ts`                   | FNV-1a bucket assignment (deterministic slug → list)           |
| `communityIssueArtifact.validation.ts`         | Zod validation for S3 artifact JSON                            |
| `trendingIssuesAgent/`                         | `trending_issues` on gp-api's own agents (see below)           |
| `topCommunityIssuesAgent/`                     | `top_community_issues` on gp-api's own agents (see below)      |

## Prisma model

`CommunityIssue` — accessed via `this.client.communityIssue` / `tx.communityIssue`.
Enum types: `CommunityIssueList`, `CommunityIssueCategory`, `CommunityIssuePriority`.

Related fields on other models:

- `Priority.sourceCommunityIssueId` + `PrioritySource.community_issue`
- `MeetingBriefingItemLink.communityIssueId`

## HTTP routes

All routes under `@Controller('community-issues')` → `/v1/community-issues`.

- `POST /dispatch` — `AdminOrM2MGuard`; dispatches both experiment types for
  a list of org slugs (`dispatchForCohort`). Ops/cohort path.
- `POST /self-dispatch` — authenticated user; dispatches a single experiment
  type (`{ type }`) for the caller's own elected-office org
  (`dispatchSelfServe`). Staff-only: rejects with `403` unless the caller's
  email ends with `@goodparty.org`. Same in-flight gating as the cohort path. Backs the staff-only buttons on the Serve Community Issues page.
- `POST /seed` — `@UseElectedOffice()`; deterministic test seeding for the
  caller's own org. Persists issues through the real `upsertFromArtifact` path
  (one COMPLETED `ExperimentRun` + artifact per list) plus optional related
  `MeetingBriefing` links — no S3 / SQS / agent run. **Disabled on qa/prod**
  (`OTEL_SERVICE_ENVIRONMENT`), so it's reachable only on local/test/preview/dev.
  Exists for the gp-webapp Community Issues e2e suite, which runs against the
  per-PR preview stack (and dev post-merge).
- `POST /dispatch-if-needed` — any authenticated user; self-serve landing
  catch-up (`dispatchIfNeeded`). Dispatches both experiment types for the
  caller's own org if not already in flight, skipping the
  inactivity gate (landing already proves activity) but applying a freshness
  gate: a list whose last completed run is within `INACTIVITY_THRESHOLD_DAYS`
  is left alone. That window is intentionally the same constant the cron uses
  to stop dispatching for an inactive user, so an active user (kept fresh by
  the cron) never re-triggers on landing, and a returning user whose issues
  went stale while they were away regenerates immediately. Distinct from
  `self-dispatch`, which is staff-only and single-type.

- `POST /onboarding` — `@UseElectedOffice()`; called by Serve onboarding the
  moment the office is on the org (on load for a prefilled or resumed
  official, right after the office PATCH for a net-new one), only while the
  `serve-citizen-panels` flag is on (it feeds the onboarding priorities step
  that flag gates). Each call costs about $1-2, so an official whose office
  already has issues they ran on (`hasWinIssues` on
  `GET /v1/elected-office/mine`, from `PrioritiesService.officesWithWinIssues`:
  the same campaign source `seedFromWin` copies) is held back until they answer
  "I'm an elected official" and move past that question. Someone who picks
  "still campaigning" or "just testing" never triggers it in that case. Called before the PATCH it would find no serve context and
  write nothing, so the client waits for the saved office, not the pick.
  **It queues `communityIssueOnboarding` and answers `{ queued: true }`**: the
  job writes up to 5 starter `top_community` issues from one Gemini Flash
  search (skipped if the org already has a top list), then calls
  `onElectedOfficeCreated` to dispatch the full runs. The work moved off the
  request in ENG-11702 because the search took 25 to 55 seconds and a mobile
  browser gave up on the fetch first, then retried into the same handler; the
  priorities step's own poll of `GET /v1/priorities/onboarding` (two minutes)
  is what shows starter issues that land after the list first loads, so it
  needs no count from this route. That read also answers `searchPending`, the
  job's own state (`JobsService.getJobState` on the org-slug key, read by the priorities service as waiting, retrying or running), so the
  step says "searching" for as long as the queue still has the work and only
  reports nothing found once the job is over, however long it waited. The job
  is keyed by org slug, so a client that retries and the tasks a burst lands
  on queue one job, not one paid generation each; that key is what prevents a
  duplicate generation, not a concurrency limit. The queue does run 15 of them
  per task, since one slot would queue every burst behind a 25 to 55 second
  search while each official waits. Onboarding creates the
  office before it has a position, so the create-time dispatch finds no serve
  context and skips; with the flag on, this is the dispatch that actually
  fires for those users.

## Both lists on gp-api's agents

`trending_issues` and `top_community_issues` each run on either engine;
`AGENTS_ON_GP_API` (a comma-separated list of the two ids) picks gp-api's own
agents (`src/agents/AGENTS.md`) per type, and a type left out stays on the PMF
Engine. `trending_issues` is on in dev and prod; `top_community_issues` is on in
dev only. `startRun` in the dispatch service is the
one dispatch fork: on gp-api's agents the run is an `AgentRun` with
`agentName` set to the type, on the PMF Engine an `ExperimentRun` with that
`experimentType`. Every gate and reader picks its table by
that same switch, because a gate that queried the other engine's table would
see nothing and let the type dispatch again: the signup check, the in-flight
check and the freshness check in `communityIssueDispatch.service.ts`, and the
refresh status in `communityIssueRead.service.ts`. The
`topCommunityIssuesDaily` 28-day bucket and the `trendingIssuesDaily` 7-day
one go through the same `startRun`, so both schedules work on either engine.

While both engines hold history, the `AgentRun` branch has one cutover
fallback: an org whose type last ran on the PMF Engine has no
`AgentRun` yet, so it is judged by its own `CommunityIssue` rows instead — the
newest `updatedAt` among its non-archived rows on that type's list that an
ingest wrote (`lastRefreshedRunId` set, so onboarding's starter rows do not
count as a refresh; every ingest stamps
`lastRefreshedRunId` on every row it keeps, which bumps `updatedAt`, unchanged
ones included). Without it, the first day after the switch re-dispatches every
active org on landing (the freshness gate finds no completion) and the read path
reports `running` with `lastCompletedAt: null`, which the webapp banner polls
forever. An org with no trending rows at all has no completion either way, so
landing starts its first run as it always did. Once an `AgentRun` exists it wins
and the rows stop mattering. The fallback measures what the user actually sees
and never reads the old engine's table, so it is deleted at teardown. The
in-flight check stays `AgentRun`-only: a run the PMF Engine started just before
the deploy is invisible there, so one org can get a duplicate run, and that is
accepted.

- `trendingIssues.prompt.ts` started as the experiment's `instruction.md` with
  the runtime swapped (input message, `getCommunityIssues`, `webSearch`,
  `checkLink`, `fetchPage`, `submitOutput`) and now leads it: the universal
  judge's sweeps showed this engine grounding claims in unread snippets,
  trusting snippet dates and padding detail sections, so the copy here requires
  a `fetchPage` for every cited source, takes `article_date` only from the
  page's own `published` date, keeps a detail section to what a cited excerpt
  states, and names the source layers a quiet district's reason fields report
  missing. While the switch exists, the two copies differ by design; the PMF
  Engine's copy is what the base arm runs.
- The office-exists gate is the one rule the judge cost twice, in both
  directions. It first read a seat missing under its own word as a real office
  (filing Hartford city news under a county commission abolished in 1960), so
  the prompt sends a nonexistent office to `insufficient_signal`. `WARD 2` in
  `FAYETTEVILLE CITY WARD 2, NC` is the voter file's word for that city's
  Council District 2, so an empty list against it is a failed run; the seat
  word is the only part of the input that translates, and looking the seat up
  by it in a namesake city is how the same rule produced three Fayetteville,
  **Arkansas** issues against a `state: 'NC'` run. Reach for this rule before
  changing either half.
- `trendingIssues.schema.ts` is the manifest's schemas. The model does not
  write `organization_slug` or `generated_for_run_id`; `trendingIssuesArtifact`
  adds them, so `onArtifact` hands `ingestAgentArtifact` the same artifact
  the PMF Engine publishes, and the same validation and upsert run.
- `ingestAgentArtifact` skips a run that already stamped issues, because
  `onArtifact` can run twice for one run.

### top_community_issues

- `topCommunityIssues.prompt.ts` is the experiment's `instruction.md` with the
  runtime swapped (input message, `getCommunityIssues`, `webSearch`,
  `fetchPage`, `checkLink`, `queryDatabricks`, `submitOutput`). Like
  trending's copy it requires a `fetchPage` for every cited source and takes
  `article_date` off the page, and it carries trending's office-exists gate.
- `queryDatabricks` reads the org's own people mart (50,000 rows max),
  `mart_gp_api.gp_api_voters` or `gp_api_constituents`: gp-api's Databricks
  principal reads `mart_gp_api` only, and which of the two a run may read is
  `PeopleDatasetService`'s choice for its org, exactly as for every other people
  read. `topCommunityIssuesDatabricksTables` resolves it when the query runs,
  from the run's own organization, and the tool accepts no other table, so no
  field in a run's input decides what it may read. The model writes the state
  and L2 district clauses itself, and the tool proves them against
  `topCommunityIssuesDatabricksScope`: the run's stored `AgentRun.input`, read
  by run id. That scope decides which predicates are legal, and its district is
  optional: when the input carries no L2 pair, `City_Ward` and every other
  district column are outside the dimension allowlist, so a query naming one is
  refused before it reaches the warehouse. `districtDescriptor` is prose for
  `webSearch` and never names a column, which the prompt states outright —
  judge runs in dev on 2026-11-21 turned 8 of 13 `queryDatabricks` calls into
  `rejected` because the model built a district clause out of that descriptor
  (and out of Step 4's own sample SQL) on cases whose input had no pair.
  `topCommunityIssues.prompt.test.ts` holds every SQL example in the prompt to
  the guard. The dispatcher builds that input from `resolveServeContext`, so in
  production it equals
  `orgDatabricksScope`; a judge run, where every case shares the fixture org,
  is scoped to the case's own district. No state, or half an L2 pair, refuses
  every query. This is narrower than the PMF Engine's broker scope in practice
  only where an office has an L2 district: the broker injected
  `Residence_Addresses_State` plus `Residence_Addresses_City` from the run
  params, and `top_community_issues`' manifest declares no `city` input
  (`additionalProperties: false`), so the broker's city clause was never
  active for this agent. The district column the office's `l2DistrictType`
  names is narrower than a city, and is the scope the instruction already
  asked the broker for in its own WHERE.
- The input carries `l2DistrictType` and `l2DistrictName` only as a pair, as
  `buildDispatchParams` does for the PMF Engine. Signup's `HIGH` priority is
  not carried over.
- `onArtifact` is the same `ingestAgentArtifact` path: the upsert with
  archive-by-omission, carried `existing_issue_id`s (so a priority made from
  an issue stays on it), task cards on a refresh, and the Segment events below,
  including Initial Issues Generated, which drives the HubSpot "your issues are
  ready" email.

## Starter issues

Starter rows have `lastRefreshedRunId: null` and a minimal `detail` (sources +
overview) that passes `DetailSchema`. The full `top_community_issues` run
reads them back through `GET_community_issues`, carries the IDs it can
verify, adds what the quick pass missed, re-ranks the whole list, and
archives the rest by omission. A starter row the official prioritized in
onboarding is kept, per the instruction's "never drop a prioritized issue".

So a starter row is not a generation: `wasFirstGenerationForList` and the
Initial Issues Generated check count only rows with a `lastRefreshedRunId`.
The first agent run is still the first generation, which keeps the
once-per-org email on agent output and keeps task cards off the first list.

## Onboarding gate

The `trendingIssuesDaily` (`0 8 * * *` UTC) and `topCommunityIssuesDaily`
(`0 9 * * *` UTC) pg-boss schedules (`fanOutSlice`) select only offices with
`onboardingCompletedAt`
set, so an office nobody finished setting up costs no agent runs. The
signup hook (`onElectedOfficeCreated`) also waits for it: `ElectedOfficeService`
calls it on an onboarded create or at the pledge. Every other dispatch path
(`POST /onboarding`, landing, staff and admin) ignores it.

## Activity gate

`dispatchTypeForOrg` (shared by the cron and `dispatchIfNeeded`) checks
`metaData.lastVisited` on the org's user via a `skipActivityGate` option,
defaulting to `true` so `dispatchForCohort`/`dispatchSelfServe` keep their
existing unconditional-dispatch behavior. The cron's per-org
`communityIssueDispatch` job (`dispatchScheduled`) is the only caller that passes `skipActivityGate: false` — if the user hasn't
opened the product in `INACTIVITY_THRESHOLD_DAYS` (30), it fires
`Community Issues - Top Issues Dispatch Skipped` or `Community Issues -
Trending Issues Dispatch Skipped` (per experiment type, feeds a HubSpot
re-engagement email) instead of dispatching. `dispatchIfNeeded` passes
`skipActivityGate: true`
explicitly. The gate itself (`isInactiveUser`, `INACTIVITY_THRESHOLD_DAYS`)
lives in `src/shared/util/userActivity.util.ts`, shared with
`meetingBriefings.service.ts` — the two domains use the same threshold and
comparison, just wired through different dispatch flows.

## Where a real run works

A real run needs `AGENT_DISPATCH_QUEUE_NAME`, and its result returns on the
env's shared agent-results queue (`src/agentExperiments/AGENTS.md`). The
exception is a type named in `AGENTS_ON_GP_API`: it
runs in gp-api's own `agentRun` worker, so it works anywhere gp-api has a
real `ANTHROPIC_API_KEY`, locally included (`top_community_issues` also needs
the `PEOPLE_DATABRICKS_*` identity for its lean query).

- **Local:** no. Don't vend AWS credentials or point a laptop at
  `agent-dispatch-dev.fifo`: dev gp-api consumes the result, finds no
  matching run in its DB, and the local row stays `QUEUED`. Use
  `POST /seed` for UI work.
- **PR preview:** no. The queue is unset by design, so dispatch flips the row
  to `FAILED`.
- **Dev:** yes, but only when triggered by hand. `MEETINGS_AUTOMATION_ENABLED`
  is `true` only in prod, and it gates only `onElectedOfficeCreated` and the
  crons. So a new dev office dispatches nothing. Use the staff buttons on the
  Serve Community Issues page (`POST /self-dispatch`, `@goodparty.org`
  login), `POST /dispatch-if-needed`, or `POST /dispatch`.
- **Prod:** yes, on real traffic. `MEETINGS_AUTOMATION_ENABLED` is `true`
  there, so a new office and the daily crons dispatch without anyone asking.

## Test command

```bash
npx vitest run src/communityIssues/
```

## Email event props

`flattenIssuesForEmail` (in `communityIssue.service.ts`) flattens ranked issues into scalar props for HubSpot. Per issue N: `…NTitle`/`…NSummary` (full text, existing workflows depend on them), `…NShortTitle` (~60 chars) and `…NTeaser` (~120 chars), both cut on a word boundary with `…` (`communityIssueEmailText.ts`). Initial/Top/Trending events also carry `leadIssueTitle` (short) and `leadIssueTeaser` for issue #1 of the list that triggered the event (top list for Initial). Use the short fields in subject lines.
