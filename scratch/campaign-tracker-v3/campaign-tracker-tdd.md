# Campaign Tracker: dynamic tasks + community events (TDD)

Epic: ENG-10406. Product context and decision log: repo `campaign-tracker-v3-context.md`. Touches gp-api, `@goodparty_org/contracts`, `packages/runbooks/experiments`, gp-webapp.

Prototype Link: https://snuggle-nav-kit.lovable.app/campaign-plan
Design diagram (CAP + cron): "Option 2" — https://drive.google.com/file/d/10v4ij2idODYwWdNJdoO2Ias9yvhNOHGd/view

> **Superseded by the June 2026 GA decision.** The coexistence model described
> below (a new table for new users while existing users stay on legacy
> `campaign_task`, with no hard switch) no longer holds. The legacy task path is
> retired: every user goes through campaign story, then campaign plan, then the
> new tracker generation flow, and legacy tasks are never shown or generated.
> Wherever this doc says "existing users keep `campaign_task`" or "branch per the
> coexistence check," read instead: every campaign is on
> `campaign_tracker_tasks`. The `community_events` JSON column stays in place but
> dead. The Monday digest reads the top 3 from `campaign_tracker_tasks` for all
> users.

## Summary

The Campaign Tracker renders a candidate's plan as phased, prioritized weekly tasks. The static catalog and the client-side presentation already ship. This doc designs the personalized half: a single weekly CAP experiment that finds local community events and prioritizes the candidate's top tasks for the week (events included), persisted in a **new `campaign_tracker_tasks` table** whose schema mirrors the existing `campaign_task` table plus a `phase` column — so we reuse the completion, CTA, and digest machinery while keeping the new tracker isolated from existing users.

## Scope

**In Scope**
- The single CAP experiment (find events + prioritize the weekly top tasks) and its inputs.
- The new `campaign_tracker_tasks` table and reusing the completion / CTA / digest / materialization logic against it.
- The weekly cron (Sunday generation), feature-flagged and initially disabled.
- The weekly digest (Monday send) for new-tracker users.

**Not In Scope**
- The static catalog, the client-side sequencer, and the UI gating (shipped; iterated separately).
- The campaign-story page that triggers plan generation (a separate in-progress feature; we define the trigger contract).
- Migrating existing users — they stay on legacy `campaign_task` (no hard switch).
- The fundraising thermometer and intake-dependent pills (future).

## Proposed Solution

### 1. New `campaign_tracker_tasks` table (reuse the tasks machinery)

All tracker tasks — static, dynamic, and events — are rows in a **new** `campaign_tracker_tasks` table whose schema is **identical to `campaign_task` plus a `phase` column**.

**Why a new table (not the existing one):** coexistence. Existing users keep their `campaign_task` rows untouched (no hard switch, no migration); the weekly wholesale-replace of dynamic rows is isolated to the new table so it can't endanger legacy data; and the new feature can evolve independently.

**Why the same schema:** reuse. With an identical shape, the completion service (advisory lock + `completed`), the CTA UI (`cta`/`link`), the digest query, and `mapTasksToCreateData` all reuse against the new model with a model swap. Events reuse the existing `flowType = events`. Static vs dynamic is the existing `isDefaultTask`. `updateHistoryId` carries voter-contact tracking along for free.

We **drop `catalog_id` and `priority`** (Review Decisions); ordering rides the existing `week`/`date` (the generator stamps them in priority order, the UI/digest sort by date). The weekly run **replaces the dynamic + event rows wholesale**; static rows persist.

```prisma
model CampaignTrackerTask {
  id                  String                 @id @default(cuid())
  createdAt           DateTime               @default(now()) @map("created_at")
  updatedAt           DateTime               @updatedAt @map("updated_at")
  title               String
  description         String
  cta                 String?
  flowType            CampaignTaskType?      @map("flow_type")   // reuse enum; events = `events`
  week                Int
  date                DateTime
  link                String?
  proRequired         Boolean?               @default(false) @map("pro_required")
  isDefaultTask       Boolean?               @default(false) @map("is_default_task") // static = true
  deadline            Int?
  defaultAiTemplateId String?                @map("default_ai_template_id")
  completed           Boolean                @default(false)
  phase               String?                // preLaunch | launch | active | gotv (the only delta)
  campaign            Campaign               @relation(fields: [campaignId], references: [id], onDelete: Cascade)
  campaignId          Int                    @map("campaign_id")
  updateHistory       CampaignUpdateHistory? @relation(fields: [updateHistoryId], references: [id], onDelete: SetNull)
  updateHistoryId     Int?                   @unique @map("update_history_id")
  @@index([campaignId, completed])
  @@map("campaign_tracker_tasks")
}
```

**Coexistence routing:** a campaign is "on the new tracker" once story + plan + launch/pre-launch have generated its `campaign_tracker_tasks` rows. The tracker UI, completion, and digest branch on that — new users hit the new table, existing users keep `campaign_task`. For new-tracker campaigns, the catalog's static tasks materialize into `campaign_tracker_tasks` **instead of** running the legacy `defaultTasks` generator.

### 2. One CAP experiment: find events + prioritize the weekly top tasks

A single experiment (not two), per the design diagram (Option 2):
- **Input:** the ~30-task catalog (the menu) + historical context — the candidate's campaign **plan**, campaign **story**, **created tasks**, **completed tasks**, plus `today` and `election_date`.
- **Step 1:** find up to **3 community events** for the upcoming window, persisted as event tasks. The 3 caps events specifically, not the overall count.
- **Step 2:** prioritize the **top 12** tasks for the week; the event tasks can appear among them.
- **Output:** the top 12 in priority order, persisted as `campaign_tracker_tasks` rows. The UI shows the **top 3 uncompleted**, revealing more as the candidate completes them (progressive reveal, up to the 12).

Key choice: the model selects, ranks, personalizes, and finds events; it does **not** set gates or dates. The GOTV 30-day window and the 3-visible cap stay deterministic in gp-api/webapp.

### 3. Weekly cron (Sunday generation, feature-flagged, initially disabled)

A new `CampaignTrackerDispatchService`, modeled on the `meeting_briefing` scheduled dispatch:
- **Generation runs Sunday morning** (a run can take a while; the Monday digest reads the result).
- Multi-pod dedup via the `CronLock` DB lease; per-campaign weekly `refreshedAt` guard.
- **No batching/throttling.** Dispatch eligible campaigns straight to the queue; the subagent-concurrency limit bounds load.
- Dispatch at **default** priority. High priority is reserved for user-waiting UI generation (the initial run while the candidate is in the campaign-story flow).
- **Eligibility (Option 2):** every campaign that has completed story + plan and has launch/pre-launch tasks (i.e. is on the new tracker), with a future election.
- **Ships disabled, behind a feature flag.** First validation: a **manual, Claude-assisted run against dev** (dummy users mirroring prod). Then a **50-campaign cost-analysis batch** before full launch (approval from Bryan).

### 4. Weekly digest (Monday send)

The digest sends **Monday, regardless** (the Friday/Sunday-to-Monday gap lets a failed run retry over the weekend). It surfaces the **top 3 uncompleted** tasks for the week. For new-tracker users it reads `campaign_tracker_tasks`; existing users keep the legacy `campaign_task` digest. Same query, table swapped by the coexistence check. Change top-5 to top-3; notify Joe (no change on their end). Cadence may be revisited with Joe.

## Initial generation + triggers

- **Static tasks (launch/pre-launch):** generated at first start, **gated by story + plan completion**. This materializes the campaign's `campaign_tracker_tasks` rows and puts it "on the new tracker." Only new users; existing users are not switched.
- **Events + dynamic tasks:** the CAP experiment first runs at **campaign-plan generation** (it needs the plan + story), then weekly (Sunday). Events appear once the plan is generated and show consistently in the plan, onboarding, and tracker. This replaces the earlier office-submission events pre-warm.
- **Visibility vs download gating:** the **campaign strategy / tracker is visible as soon as the static tasks are materialized** — the candidate can start working immediately. The **plan PDF download stays gated until all tasks are generated** (the dynamic + event CAP run completes, i.e. `trackerRefreshedAt` is set).

## API surface

| Method & path | Purpose | Consumers | Change |
|---|---|---|---|
| GET /v1/campaigns/tracker-tasks | fetch tracker rows (static/dynamic/event) | tracker, digest | new (mirrors `/campaigns/tasks`) |
| PUT/DELETE /v1/campaigns/tracker-tasks/complete/:id | mark (un)complete | tracker | new (reuses `completeTask` logic) |
| GET /v1/campaignStrategy/mine | plan payload; add tracker generation status | webapp | extended |

New endpoints, but the service logic is reused from the legacy tasks paths against the new model. Legacy `/campaigns/tasks` is untouched (existing users). The cron and the experiment result handler are internal.

## Key Takeaways

- **New `campaign_tracker_tasks` table, schema = `campaign_task` + `phase`.** Coexistence: existing users untouched (no hard switch); new users go on the new table once they have story + plan + launch/pre-launch.
- **Reuse the completion / CTA / digest / materialization logic** against the new model — that's the whole point of keeping the schema identical.
- **One CAP experiment**: find up to 3 events + prioritize the top-12 tasks; top 3 shown with progressive reveal.
- **Drop `catalog_id` and `priority`;** order by the existing `week`/`date`. The weekly run wholesale-replaces dynamic + event rows; static rows persist.
- **Generation Sunday; digest Monday.** No batching; default dispatch priority (high for user-waiting UI). Ships disabled behind a flag; manual dev run + 50-campaign cost batch (Bryan) before full launch.
- **Eligibility (Option 2):** all campaigns with story + plan completed and launch/pre-launch tasks.
- **Strategy shows on static-task creation; plan download waits for full generation** (dynamic + events done).
- Events reuse `flowType = events`; the `community_events` JSON column is deprecated. Active is **not** locked; deterministic gates/caps stay in gp-api/webapp.

## Alternatives Considered

- **Reuse the existing `campaign_task` table (no new table).** Rejected: mixing new + legacy rows in one table risks the live feature, complicates the weekly wholesale-replace, and forces a hard switch for existing users. A separate table coexists cleanly.
- **Redesign the new table's schema** (explicit `type`/`rank`/`channel` columns). Rejected: it would force rewriting completion, CTA, digest, and materialization for no real gain. Identical-schema-plus-`phase` reuses all of it.
- **Two experiments (events + tasks separately).** Rejected: one experiment shares context, can promote an event into the weekly set, and is a single dispatch.
- **Store events in `campaign_strategy.community_events` JSON.** Rejected: events could not be completed and created a plan/tracker discrepancy. As tasks they are completable and single-sourced.
- **Batch / throttle the CAP dispatch.** Rejected: the subagent concurrency cap already bounds load.

## Open Questions

1. **Trigger handoff with the campaign-story feature** — the exact call that, on story + plan completion, materializes the launch/pre-launch rows and kicks the initial experiment. Cross-team; deferred to implementation.
2. **Coexistence routing detail** — the precise per-campaign check the UI / completion / digest use to choose the new table vs legacy (presence of `campaign_tracker_tasks` rows vs a flag). Deferred to implementation.

Resolved during review:
- **New table = `campaign_task` schema + `phase`**, reuse the logic; order by `week`/`date` (no `rank`).
- **Coexistence:** no hard switch; existing users stay on legacy; new users on the new table after story + plan + launch/pre-launch.
- **Eligibility = Option 2** (all who completed story + plan and have launch/pre-launch).
- **First-start:** trigger launch/pre-launch generation, gated by story/plan.
- **Visibility vs download:** strategy/tracker visible as soon as static tasks are materialized; the plan PDF download is gated until full generation (dynamic + events) completes.
- **Cadence:** generate Sunday, send the digest Monday (revisit with Joe).
- **Phase** lives on the new table (the only schema delta).
- **Prompt-quality:** adopt the PMF QA gate (in-run evals, observe-by-default / blocking opt-in); see Implementation Notes → Testing.
- Up to **3 event tasks** per run; **top 12** generated, **top 3** shown.
- Events first appear at **campaign-plan generation**; **deprecate** the `community_events` JSON column + endpoint.

---

# Implementation Notes (relocate to a ClickUp subpage)

Deep detail pulled out of the review doc so the main TDD stays a ~15-minute read.

## CAP engine

Author an experiment in `packages/runbooks/experiments/<id>/` (`manifest.json` + `instruction.md`), publish via `publish_experiments.py`; the I/O types generate into `AgentJobContracts` (`gp-api/src/generated/agent-job-contracts.ts`, plus a webapp copy) — so the experiment input/output is authored as JSON Schema in the manifest, not hand-written Zod. `ExperimentRunsService.dispatchRun({ type, organizationSlug, clerkUserId, params, priority })` creates an `ExperimentRun` (runId, RUNNING). Partial runs resume; stale runs swept after 45 min; runs observable in `admin/agentRuns`. Use **default** priority for the weekly cron and **high** priority for user-waiting UI generation.

## meeting_briefing precedent (the pattern we copy)

`MeetingBriefingsService.dispatchDailyBriefings` `@Cron('0 7 * * *')` (`gp-api/src/meetings/services/meetingBriefings.service.ts:625`):
- **Multi-pod dedup via DB lease:** `CronLockService` (`src/cron/services/cronLock.service.ts`) — unique `(jobName, runDate)` on `CronRun`; first INSERT wins; 6-hour stale takeover.
- **Result:** `onExperimentRunCompleted` reads the artifact, validates status, and is **fail-closed** (placeholder statuses are not persisted so the next cron retries).

We copy the lease + result handling, but **not** the batching: meeting_briefing batches 100 with 20-min sleeps; we dispatch straight to the queue and rely on the subagent concurrency cap.

## Weekly cron skeleton

```
@Cron('0 9 * * 0', { timeZone: 'America/Chicago' })   // Sunday morning generation
async dispatchWeeklyRegen() {
  if (!isTrackerCronEnabled()) return          // feature flag; ships disabled
  if (!await cronLock.tryClaimDailyRun('campaignTrackerWeeklyRegen', now)) return
  const campaigns = await selectEligible()     // on new tracker, future election
  for (const c of campaigns) {
    await dispatchRegenIfNeeded(c, now).catch(log)   // no batch/sleep; queue-bounded
  }
  await cronLock.markCompleted('campaignTrackerWeeklyRegen', now)
}
```

`dispatchRegenIfNeeded` gates: skip if `trackerRefreshedAt` is within this week; skip campaigns not on the new tracker yet. Dispatch the experiment `mode=weekly` at **default** priority with prior context. New `CronRun` job name `campaignTrackerWeeklyRegen` (reuses the existing table). The Monday digest reads whatever Sunday produced.

## Result + persistence

Reuse `handleAgentExperimentResult`; add an `onExperimentRunCompleted` case for the tracker experiment (mirror `campaignStrategy.onExperimentRunCompleted`):
- Load the artifact from S3, parse against the output schema, persist race-guarded; fail-closed.
- **Replace** the campaign's dynamic + event `campaign_tracker_tasks` rows (those with `isDefaultTask = false`) with the new top-12; events as `flowType = events`; set `phase` + the display fields; stamp `week`/`date` from the returned priority order. Static rows (`isDefaultTask = true`) are left in place. Stamp `trackerRefreshedAt`.

## Reuse map (logic shared with legacy tasks)

- **Materialization:** `mapTasksToCreateData` + `orderDefaultTasksForCampaign` reused against the new model to create the static rows.
- **Completion:** `CampaignTasksService.completeTask` / `unCompleteTask` (advisory lock, `CampaignUpdateHistory` write) reused against the new model behind the new `/tracker-tasks/complete/:id` routes.
- **Digest:** the top-N selection query reused with the table swapped per the coexistence check.
- **Schema wrinkle:** `CampaignUpdateHistory` currently back-relates to `campaign_task`; adding the same optional relation from `campaign_tracker_tasks` needs a second back-relation on `CampaignUpdateHistory` (or drop `updateHistoryId` on the new table until voter-contact tracking is needed there).

## Experiment instruction.md guidance

- Step 1 (events): real local events only (no generic recurring filler), upcoming window, never invent addresses.
- Step 2 (tasks): personalize copy in the candidate's voice; select/rank from the ~30-task catalog using plan + story + created/completed tasks; an event may be promoted into the top 12; avoid repeating same-type tasks; GOTV reframe in the last 30 days; never invent dates/numbers/compliance.

## Contracts + migration

- **Catalog (done):** the ~30-task catalog + its Zod schema now live in `@goodparty_org/contracts` (`CampaignTaskCatalog.schema.ts` + `.data.ts`).
- **Experiment I/O:** authored as JSON Schema in the runbooks `manifest.json`; flows into `AgentJobContracts`.
- **Migration:** add the `campaign_tracker_tasks` table (mirror `campaign_task` + `phase`). Deprecate the `community_events` JSON column (events move to tracker rows). No change to `campaign_task`.

## Webapp consumption

The section keeps its client-side `buildCampaignStrategy` presentation but reads `campaign_tracker_tasks` rows (static + dynamic + event) for new-tracker campaigns instead of the bundled catalog's template copy; group by `phase`, render the row's copy. Deterministic gates/caps/banner stay in the sequencer. A hook fetches tracker tasks + the generation status (generating/ready).

## Rollout

- Behind a tracker feature flag, **initially disabled**; only new users (story + plan + launch/pre-launch) are on the new tracker.
- **Validate first via a manual, Claude-assisted cron run against dev**, on dummy users mirroring prod.
- Then a **50-campaign cost-analysis batch** before full launch; approval from Bryan.
- Land contracts + gp-api + webapp together. Retire the Gemini events pipeline once events-as-tasks is validated.
- Preview envs have no agent-dispatch queue (`AGENT_DISPATCH_QUEUE_NAME` unset) — generation no-ops there, same as strategic-landscape.

## Testing

- **Experiment (shape/behavior):** manifest schema validation; PMF-harness behavior on golden inputs — artifact shape, no-repeat, event-found, no-invented-data, only real catalog task ids.
- **Experiment (quality):** adopt the existing **PMF QA gate** (in-run quality evals, observe-by-default / blocking opt-in). Tracker rubric: events real/local/dated; tasks relevant + grounded in plan/story + non-duplicative; no invented dates/numbers/compliance. Observe during the dev run + 50-campaign batch (product owns the qualitative review); flip to blocking before full launch.
- **gp-api:** vitest for the dispatch service (selection/gating), the result callback (parse + fail-closed + wholesale replace + race guard), the cron lease, and a completion round-trip on `campaign_tracker_tasks`.
- **Digest:** vitest that it selects the top-3 uncompleted for the week and picks the right table per the coexistence check.
- **webapp:** sequencer tests for gates/caps; a task-completion round-trip (including event tasks).

## Build order

1. Contracts: the ~30-task catalog (done) + the runbooks experiment manifest (I/O schemas).
2. `campaign_tracker_tasks` table migration; reuse materialization to create static rows on first start (story/plan gated); reuse completion + CTA against the new model in the tracker UI; deprecate `community_events` JSON.
3. The tracker CAP experiment (events + top-12) + initial dispatch at campaign-plan generation (high priority) + result persist (wholesale replace of dynamic/event rows).
4. `CampaignTrackerDispatchService` weekly cron (Sunday, CronLock lease, default priority, no batching), behind the disabled flag.
5. Digest: top-5 -> top-3, table-swap per coexistence; notify Joe.
6. Manual dev validation run -> 50-campaign cost batch -> Bryan approval -> ramp.
7. Retire the Gemini events pipeline.
