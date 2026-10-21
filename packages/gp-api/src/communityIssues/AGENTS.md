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
  write nothing, so the client waits for the saved office, not the pick. The
  priorities step keeps polling `GET /v1/priorities/onboarding` for a while
  so starter issues that land late still appear. Writes up to 5
  starter `top_community` issues from one Gemini Flash search (skipped if the
  org already has a top list), then calls `onElectedOfficeCreated` to dispatch
  the full runs. Onboarding creates the
  office before it has a position, so the create-time dispatch finds no serve
  context and skips; with the flag on, this is the dispatch that actually
  fires for those users.

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

## Activity gate

`dispatchTypeForOrg` (shared by the cron and `dispatchIfNeeded`) checks
`metaData.lastVisited` on the org's user via a `skipActivityGate` option,
defaulting to `true` so `dispatchForCohort`/`dispatchSelfServe` keep their
existing unconditional-dispatch behavior. The cron (`dispatchSlice`) is the
only caller that passes `skipActivityGate: false` — if the user hasn't
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
env's shared agent-results queue (`src/agentExperiments/AGENTS.md`).

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

## Test command

```bash
npx vitest run src/communityIssues/
```

## Email event props

`flattenIssuesForEmail` (in `communityIssue.service.ts`) flattens ranked issues into scalar props for HubSpot. Per issue N: `…NTitle`/`…NSummary` (full text, existing workflows depend on them), `…NShortTitle` (~60 chars) and `…NTeaser` (~120 chars), both cut on a word boundary with `…` (`communityIssueEmailText.ts`). Initial/Top/Trending events also carry `leadIssueTitle` (short) and `leadIssueTeaser` for issue #1 of the list that triggered the event (top list for Initial). Use the short fields in subject lines.
