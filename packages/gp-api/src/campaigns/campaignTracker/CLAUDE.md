# campaignTracker/

Campaign Tracker v3 (ENG-10406) backend. Owns the `campaign_tracker_tasks` table
and the lifecycle that fills it: bootstrap at plan completion, the weekly CAP
re-generation, persistence of the agent artifact, and task completion. Feature
overview: `docs/features/campaign-tracker-v3.md`.

## Key files

| File | Role |
|------|------|
| `services/campaignTrackerTasks.service.ts` | Core. Bootstrap (atomic claim + materialize + dispatch), dispatch params, artifact persistence (append), completion. |
| `services/campaignTrackerDispatch.service.ts` | Thursday `@Cron` weekly re-generation (env-gated, CronLock dedup, active/non-demo cohort); primary-loss gate (tears down outreach + skips). |
| `services/staticTrackerTasks.util.ts` | Builds the static catalog rows **and** the 7 deterministic outreach rows (`buildOutreachTrackerTaskRows`) from `@goodparty_org/contracts` at bootstrap. |
| `campaignTracker.controller.ts` | `/campaigns/tracker-tasks` GET (also an `@McpTool`) + complete/uncomplete. |
| `schemas/trackerTaskResponse.schema.ts` | `@ResponseSchema` for the GET (required for the MCP tool). |
| `campaignTracker.consts.ts` | Experiment type, cron job name, `CHANNEL_TO_FLOW_TYPE` (the canonical map). |

## Patterns / non-obvious logic

- **Append, never replace (the central rule).** `onExperimentRunCompleted`
  stamps each run's rows with `week = max(existing dynamic week) + 1` and never
  deletes prior generations. This preserves completion across weekly re-runs and
  keeps history for the weekly agent's prior-task lookup. Consequence: every
  reader must scope to the latest generation. The frontend (`buildTrackerStrategy`)
  and the digest (`weeklyTasksDigestHandler`, a separate `latest_gen` CTE) both do.
- **Bootstrap is gated on campaign story, then an atomic claim.**
  `bootstrapTrackerIfPlanComplete` (in `campaignStrategy.service.ts`) only
  proceeds if a `campaign_story` row exists. The tracker takes the story as
  input, so story-off (legacy) campaigns generate their plan but never bootstrap
  the tracker. The gate is on the story *data*, not the flag, so it holds
  regardless of flag state. Then: two plan sections complete on independent SQS
  messages, so `bootstrapForCampaign` claims `CampaignStrategy.trackerBootstrapped`
  with one conditional `updateMany` (false->true); only the winner materializes +
  dispatches, and the claim is released on failure so a later trigger retries.
- **Static rows materialize eagerly, at plan-generation start.**
  `getOrGenerateStrategicLandscape` calls `materializeStaticTasks` (story-gated,
  best-effort) so the static checklist + outreach render immediately, without
  waiting for the SQS-driven completion bootstrap (which never fires in local
  dev). The dynamic `dispatchGeneration` still runs only from the completion
  bootstrap (it needs the finished plan). `materializeStaticTasks` is idempotent
  and race-safe via a per-campaign `pg_advisory_xact_lock`
  (`TRACKER_STATIC_TASKS_ADVISORY_LOCK_KEY`), because the plan endpoint is polled
  and the count-check alone isn't atomic, so the eager call and the bootstrap
  call can't double-insert the catalog.
- **The model only selects/ranks/voices/finds-events.** Gates, caps, and the
  generation/dating logic are deterministic here, not in the agent. Dateless
  dynamic tasks are dated across the upcoming Mon-Sun week (counter skips dated
  events; `nextMondayUtcMidnight`, shared with the digest, so dates land in the
  digest window). Events keep their real date.
- **Outreach (text/robocall) is deterministic, never agent-selected.** The 7
  sends are the catalog's `channel ∈ {text, robocall}` entries, materialized at
  bootstrap by `buildOutreachTrackerTaskRows` (`isDefaultTask: true`,
  `electionRelative` dates off the **general** election). Belt and suspenders:
  the catalog attachment excludes them (see the generator) and
  `onExperimentRunCompleted` drops any `text`/`robocall` rows the agent emits.
- **Lost primary → tear down outreach, stop generating.** The weekly dispatcher
  checks `campaign.primaryResult === 'lost'` (synced from HubSpot `Lost Primary`)
  before the date/dedup checks; if lost it calls `removeOutreachTasks` (deletes
  the default text/robocall rows) and returns without dispatching. Checked in the
  dispatcher, not bootstrap, because the loss is recorded after outreach exists.
- **Generation posts to Slack (Pro only).** After `onExperimentRunCompleted`
  commits the rows, `notifyTasksGenerated` posts the upcoming Mon-Sun week to
  `casClickupTasks` for **Pro** candidates, for both the initial bootstrap
  (generation 1, "first week" title) and weekly regens. Best-effort: wrapped in a
  `.catch` so a Slack failure is logged but never reaches the run's catch (which
  would `markFailed` + redeliver).
- **Pro upgrade posts the current week (Pro only).** `notifyProUpgrade` posts the
  week the candidate is in now (via `currentMondayUtcMidnight`), routed from
  `CampaignTasksService.notifySlackOnProUpgrade` for tracker-cohort campaigns. All
  three Slack messages share `postCampaignWeekToSlack` + the casClickupTasks
  channel; every one is Pro-gated.
- **Catalog ships as an experiment attachment, not a param** (6 KB SQS limit);
  prior tasks come back to the agent via the MCP tracker-tasks tool. The
  generator filters to `type === 'dynamic'` **and** excludes text/robocall (the
  outreach is deterministic). See `scripts/generate-tracker-catalog.ts` and the
  runbooks experiment.
- **Completion / CTA / update-history reuse `CampaignTasksService` shape** (WET
  copies on purpose) against the new model.

## Gotchas

- `week` is a generation index on dynamic rows but a calendar offset on the
  deterministic rows (static catalog + outreach, both `isDefaultTask = true`).
  Comparisons that mean "latest generation" filter `isDefaultTask = false` first
  (so a default-row `week` never pollutes the max).
- The digest is a *separate* consumer of this table; a change to what counts as
  "current" must be mirrored in `weeklyTasksDigestHandler.service.ts`.
- **The digest serves two cohorts.** `weeklyTasksDigestHandler` runs one query
  over `campaign_tracker_tasks` (this table) and a second over the legacy
  `campaign_task` table, guarded by `NOT EXISTS (campaign_tracker_tasks)` so the
  two cohorts are mutually exclusive, so each campaign gets exactly one digest.
  Don't assume a campaign in the digest is on the tracker.
- **Legacy `campaign_task` coexists** (not a hard flip): story-off campaigns
  keep the legacy generator, dashboard task list, onboarding success page, and
  `community_events` JSON column. The new tracker is the story cohort's path
  only. Gating lives on the `campaign-story` flag (routing/UI) + `campaign_story`
  existence (bootstrap).
