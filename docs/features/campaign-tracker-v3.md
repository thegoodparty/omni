# Campaign Tracker v3 (ENG-10406)

Renders a candidate's campaign plan as phased, dated, prioritized **weekly
tasks plus local events**. Static checklist tasks come from a fixed catalog and
appear immediately; the personalized half (which dynamic tasks to surface this
week, plus real local events) is produced by a weekly CAP agent experiment and
persisted as task rows the candidate can check off.

Spans four packages: `gp-api` (data model, bootstrap, weekly cron, digest, MCP
tool), `gp-webapp` (the Campaign Plan rendering), `packages/runbooks` (the CAP
experiment), and `@goodparty_org/contracts` (the task catalog + experiment I/O).

## What the candidate sees

The Campaign Plan page (`/dashboard/campaign-plan`) shows a four-phase rail:
**Pre-launch, Launch, Active campaign, Get out the vote**. Each phase holds
dated task cards the candidate works through and marks complete.

- **Static tasks** (the launch / pre-launch checklist) render the moment the
  tracker is bootstrapped, so there is something to do immediately.
- **Dynamic tasks and events** land a few minutes later when the first agent
  run completes. While they generate, a banner says so.
- The Active / GOTV phases show the **top 3 uncompleted** tasks and reveal more
  as the candidate completes them (progressive reveal).
- GOTV tasks stay hidden behind a window message until the election is within
  **30 days**.
- A **Monday digest** emails the candidate their top 3 uncompleted tasks for
  the week.

## Lifecycle (GA: hard flip, no legacy path)

All candidates go through the same flow. There is no coexistence with the old
`campaign_task` tracker; legacy tasks are never generated or shown.

1. Candidate completes **Campaign Story** (why / background / issues).
2. **Campaign Plan** generates (the `campaignStrategy` opposition + opportunity
   sections). When both sections persist, the tracker bootstraps.
3. **Bootstrap** materializes the static rows and dispatches the first CAP run.
4. Each **Sunday** (once the weekly cron is enabled) a CAP run re-prioritizes
   the week and refreshes events.

Existing candidates who onboarded before this shipped are routed back through
Campaign Story by the flow gating; their tracker bootstraps when they
regenerate. There is no backfill of pre-existing campaigns by design.

## Data model

One table, `campaign_tracker_tasks` (`prisma/schema/campaignTrackerTask.prisma`),
whose schema mirrors the legacy `campaign_task` plus a `phase` column, so the
completion / CTA / update-history machinery is reused against it.

| Field | Meaning |
|-------|---------|
| `isDefaultTask` | `true` = static catalog row; `false` = dynamic task or event |
| `flowType` | channel (`text`, `robocall`, `events`, …); `events` marks event rows |
| `phase` | `preLaunch` \| `launch` \| `active` \| `gotv` (drives the rail) |
| `week` | **generation index** (see below), not a calendar week |
| `date` | when the task is scheduled (drives sorting + the digest window) |
| `completed` | per-task completion; `updateHistoryId` links voter-contact logging |

`CampaignStrategy.trackerBootstrapped` (boolean) is the one-shot bootstrap
claim (see Bootstrap below). The legacy `campaign_strategy.community_events`
JSON column is dead but left in place.

### The append (generation) model

Each completed CAP run **appends** a new generation rather than replacing the
last. The run stamps every row it writes with `week = max(existing dynamic
week) + 1`; prior generations are never deleted. This is the central design
choice and it has consequences every consumer must respect:

- **Why append:** completion survives a weekly re-run (a checked-off task is
  not wiped), and the full history stays in the table for the weekly agent's
  prior-task lookup (so it can avoid repeating itself).
- **Consumers scope to the latest generation.** The frontend and the digest
  both render only `max(week)` among dynamic rows (plus the non-generational
  static rows). Older generations exist only for history and completion record.
- **Dating.** Dateless dynamic tasks are dated across the upcoming Monday-Sunday
  week using a counter that skips dated events (so an event in an early slot
  cannot push a task past the week). The Monday anchor is computed timezone
  aware (`nextMondayUtcMidnight`, shared with the digest) so the dated tasks and
  the digest window agree.

## Generation flow

### Bootstrap (initial run)

`campaignStrategy.service.ts → bootstrapTrackerIfPlanComplete` fires once both
plan sections have persisted, calling
`CampaignTrackerTasksService.bootstrapForCampaign`:

1. **Atomic claim.** A single conditional update flips
   `CampaignStrategy.trackerBootstrapped` `false → true`. The two plan sections
   complete on independent SQS messages (possibly different pods), so only the
   writer that wins the claim proceeds; the loser no-ops. This prevents
   double-materialize / double-dispatch. If the work then throws, the claim is
   released so a later trigger can retry.
2. **Materialize static rows** from the contracts catalog
   (`staticTrackerTasks.util.ts`), anchored to the upcoming Monday.
3. **Dispatch** the initial CAP run (`mode = initial`, high priority).

### The CAP experiment

`packages/runbooks/experiments/campaign_tracker_tasks/` (`manifest.json` +
`instruction.md`). Inputs (dispatched as params): `race_id`, `user_full_name`,
`mode`, `today`, `election_date` (falls back to `primaryElectionDate`), `state`,
`city`, and `campaign_plan` / `campaign_story` summaries assembled from the DB.

Two things deliberately do **not** ride in params, to stay under the 6 KB SQS
dispatch limit:

- The **task catalog** (the menu the agent selects from) ships as an experiment
  **attachment** (`attachments/task_catalog.json`, generated from
  `@goodparty_org/contracts` by `scripts/generate-tracker-catalog.ts`). The
  runner drops it at `/workspace/task_catalog.json`.
- **Prior tasks + completion** are fetched live (weekly mode) via the MCP tool
  `GET /v1/campaigns/tracker-tasks` (`@McpTool` on the tracker controller), so
  the agent sees what it generated before and what the candidate finished.

Output: up to **12** prioritized tasks plus up to **3** real local events. The
model selects, ranks, personalizes, and finds events; it does **not** set gates
or caps. The GOTV 30-day window and the 3-visible cap stay deterministic in
gp-api / webapp.

`onExperimentRunCompleted` loads the artifact, computes the next generation
index, and **appends** the rows (events keep their real date; dateless tasks
dated across the upcoming week). Fail-closed: a bad artifact marks the run
failed and rethrows.

### Weekly regeneration

`CampaignTrackerDispatchService.dispatchWeeklyRegen` (`@Cron` Sunday 9am
Central), gated by the `CAMPAIGN_TRACKER_AUTOMATION_ENABLED` env flag (ships
disabled). It uses a `CronLock` lease for multi-pod dedup, selects active,
non-demo campaigns that already have tracker rows, and skips any campaign with
a non-failed run in the last 6 days (a failed run is ignored so a stuck week
retries). Dispatches `mode = weekly` at default priority.

### Weekly digest

`weeklyTasksDigestHandler.service.ts` reads `campaign_tracker_tasks`, scopes to
the latest dynamic generation plus static rows, and emails the **top 3
uncompleted** tasks dated in the upcoming Monday-Sunday window. It excludes GOTV
tasks until the election is within 30 days (matching the UI), and excludes
inactive / demo campaigns. Election date falls back to `primaryElectionDate`.

## Key files

| Area | Path |
|------|------|
| Tracker service (bootstrap, dispatch params, append-persist, completion) | `gp-api/src/campaigns/campaignTracker/services/campaignTrackerTasks.service.ts` |
| Weekly cron | `gp-api/src/campaigns/campaignTracker/services/campaignTrackerDispatch.service.ts` |
| Static row materialization | `gp-api/src/campaigns/campaignTracker/services/staticTrackerTasks.util.ts` |
| Controller + MCP tool | `gp-api/src/campaigns/campaignTracker/campaignTracker.controller.ts` |
| Bootstrap trigger | `gp-api/src/campaignStrategy/services/campaignStrategy.service.ts` |
| Digest | `gp-api/src/campaigns/tasks/services/weeklyTasksDigestHandler.service.ts` |
| Shared week-start helper | `gp-api/src/shared/util/date.util.ts` (`nextMondayUtcMidnight`) |
| Catalog generator | `gp-api/scripts/generate-tracker-catalog.ts` |
| CAP experiment | `packages/runbooks/experiments/campaign_tracker_tasks/` |
| Task catalog (source of truth) | `@goodparty_org/contracts` (`CampaignTaskCatalog`) |
| Frontend rendering | `gp-webapp/app/dashboard/campaign-plan/components/campaignStrategy/buildTrackerStrategy.ts` |
| Frontend data hook | `…/campaignStrategy/useTrackerTasks.ts` |
| Frontend section | `…/campaignStrategy/CampaignStrategySection.tsx` |

## Frontend specifics

- `buildTrackerStrategy.ts` builds the rail from rows: filter dynamic rows to
  `max(week)`, bucket by phase, and apply the deterministic display rules. A
  phase reads `done` only when **all** its tasks are completed; the "happening
  now" (active) phase is **date-driven**. The Active / GOTV phases cap at 3 with
  progressive reveal and surface a hidden-count hint; GOTV is gated to the final
  30 days.
- `useTrackerTasks.ts` polls fast (20s) while dynamic tasks are still
  generating, then drops to a slow background poll (so a weekly regen is picked
  up) with a fast-poll budget cap.
- `CampaignStrategySection.tsx` shows loading / error / generating states and
  falls back to the client-side catalog only once the fetch settles with no
  rows.

## Rollout and ops

- **Weekly cron:** `CAMPAIGN_TRACKER_AUTOMATION_ENABLED=true` (env) turns on
  Sunday regeneration. Ships disabled.
- **Flow gating:** the `campaign-story` / `campaign-strategy` Amplitude flags
  gate the campaign-story → plan → tracker flow. The plan is to drop these and
  hard-flip (a follow-up), since the off state is not a usable fallback once the
  legacy task display was removed.
- Cost is roughly $0.94 per candidate per run (validated on dev cohorts;
  approved by Bryan).
- Preview envs have no agent-dispatch queue, so generation no-ops there.

## How this diverged from the original TDD

The design doc (`scratch/campaign-tracker-v3/`, since removed) proposed
coexistence with the legacy tracker and a weekly **wholesale replace** of
dynamic rows. Two GA decisions changed that:

1. **Hard flip, no coexistence.** Legacy `campaign_task` generation and display
   were retired; all candidates use this tracker. There is no per-campaign
   routing between old and new.
2. **Append, not replace.** Wholesale-replace wiped completion every week and
   kept no history for the agent. The append model preserves both, at the cost
   of every consumer scoping to the latest generation.
