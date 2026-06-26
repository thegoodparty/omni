# campaignTracker/

Campaign Tracker v3 (ENG-10406) backend. Owns the `campaign_tracker_tasks` table
and the lifecycle that fills it: bootstrap at plan completion, the weekly CAP
re-generation, persistence of the agent artifact, and task completion. Feature
overview: `docs/features/campaign-tracker-v3.md`.

## Key files

| File | Role |
|------|------|
| `services/campaignTrackerTasks.service.ts` | Core. Bootstrap (atomic claim + materialize + dispatch), dispatch params, artifact persistence (append), completion. |
| `services/campaignTrackerDispatch.service.ts` | Sunday `@Cron` weekly re-generation (env-gated, CronLock dedup, active/non-demo cohort). |
| `services/staticTrackerTasks.util.ts` | Builds the static catalog rows from `@goodparty_org/contracts` at bootstrap. |
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
- **Bootstrap is an atomic claim.** Two plan sections complete on independent SQS
  messages, so `bootstrapForCampaign` claims `CampaignStrategy.trackerBootstrapped`
  with one conditional `updateMany` (false->true); only the winner materializes +
  dispatches, and the claim is released on failure so a later trigger retries.
- **The model only selects/ranks/voices/finds-events.** Gates, caps, and the
  generation/dating logic are deterministic here, not in the agent. Dateless
  dynamic tasks are dated across the upcoming Mon-Sun week (counter skips dated
  events; `nextMondayUtcMidnight`, shared with the digest, so dates land in the
  digest window). Events keep their real date.
- **Catalog ships as an experiment attachment, not a param** (6 KB SQS limit);
  prior tasks come back to the agent via the MCP tracker-tasks tool. See
  `scripts/generate-tracker-catalog.ts` and the runbooks experiment.
- **Completion / CTA / update-history reuse `CampaignTasksService` shape** (WET
  copies on purpose) against the new model.

## Gotchas

- `week` is a generation index on dynamic rows but a calendar offset on static
  rows. Comparisons that mean "latest generation" filter `isDefaultTask = false`
  first (so static `week` never pollutes the max).
- The digest is a *separate* consumer of this table; a change to what counts as
  "current" must be mirrored in `weeklyTasksDigestHandler.service.ts`.
- Legacy `campaign_task` generation is retired (hard flip). The dead
  `community_events` column + its orphaned route are left for a separate teardown.
