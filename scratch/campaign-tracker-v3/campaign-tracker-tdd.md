# Campaign Tracker: dynamic tasks + community events (TDD)

Epic: ENG-10406. Product context and decision log: repo `campaign-tracker-v3-context.md`. Touches gp-api, `@goodparty_org/contracts`, `packages/runbooks/experiments`, gp-webapp.

Prototype Link: https://snuggle-nav-kit.lovable.app/campaign-plan
Design diagram (CAP + cron): "Option 2" — https://drive.google.com/file/d/10v4ij2idODYwWdNJdoO2Ias9yvhNOHGd/view

## Summary

The Campaign Tracker renders a candidate's plan as phased, prioritized weekly tasks. The static catalog and the client-side presentation already ship. This doc designs the personalized half: a single weekly CAP experiment that finds local community events and prioritizes the candidate's top tasks for the week (events included), all persisted as `campaign_task` rows so completion, CTAs, the plan, and the weekly digest read one source.

## Scope

**In Scope**
- The single CAP experiment (find events + prioritize the weekly top tasks) and its inputs.
- Persisting static, dynamic, and event tasks as `campaign_task` rows.
- The weekly cron that re-runs the experiment, feature-flagged and initially disabled.
- The weekly digest email (it surfaces the same prioritized tasks, so it belongs here).

**Not In Scope**
- The static catalog, the client-side sequencer, and the UI gating (shipped; iterated separately).
- The campaign-story page that triggers plan generation (a separate in-progress feature; we define the trigger contract).
- The fundraising thermometer and intake-dependent pills (future).

## Proposed Solution

### 1. Persist all tasks (static, dynamic, events) as `campaign_task` rows

Reuse the existing tasks system; no new store. `campaign_task` already has `completed`, `cta`, `link`, `proRequired`, `flowType`, `week`, `date`, plus the completion flow (`PUT/DELETE /campaigns/tasks/complete/:id`), the dashboard CTA UI, and the digest.

- **Static** Pre-launch/Launch tasks replace the current `defaultTasks` generator: materialize rows from the catalog during onboarding (programmatic, no AI).
- **Dynamic tasks + events** come from the weekly CAP run (subproblem 2), written as `campaign_task` rows. Events use the existing `flowType = events`, so they are markable-complete like any task. There is **no `community_events` JSON** and no separate event store.
- **One source of truth:** the plan, onboarding, the tracker, and the digest all read `campaign_task`. (Reviewer/Terry: we don't want a discrepancy between plan/onboarding and the tracker — confirmed.)

**No new `campaign_task` columns.** We **drop `catalog_id` and `priority`**. The CAP output carries each task's display fields (title, description, channel) directly onto the row; weekly priority is expressed by the existing `week`/`date` (the cron writes the upcoming week's set). The weekly run **replaces** the generated (non-static) rows wholesale rather than upserting by a stable key.

> `catalog_id` purpose (now dropped): it was a stable key to (a) upsert-match a candidate's row across weekly regen and (b) resolve phase/channel from the catalog. With wholesale weekly replace and display fields stored on the row, it isn't needed. (See Open Questions for whether a `phase` column is still required for the 4-phase UI.)

### 2. One CAP experiment: find events + prioritize the weekly top tasks

A single experiment (not two), per the design diagram:
- **Input:** the ~30-task catalog (the menu) + historical context — the candidate's campaign **plan**, campaign **story**, **created tasks**, and **completed tasks**, plus `today` and `election_date`.
- **Step 1:** find up to **3 community events** for the upcoming window, persisted as event tasks. The 3 caps events specifically, not the overall task count.
- **Step 2:** prioritize the **top 12** tasks for the week; the event tasks can appear among them.
- **Output:** the top 12 in priority order, persisted as `campaign_task` rows. The UI shows the **top 3 uncompleted**, revealing more as the candidate completes them (progressive reveal, up to the 12).

Key choice: the model selects, ranks, personalizes, and finds events; it does **not** set gates or dates. The GOTV 30-day window and the 3-visible cap stay deterministic in gp-api/webapp.

### 3. Weekly cron (feature-flagged, initially disabled)

A new `CampaignTrackerDispatchService`, modeled on the `meeting_briefing` scheduled dispatch:
- Weekly schedule (exact day/time TBD vs the digest send — Open Question).
- Multi-pod dedup via the `CronLock` DB lease; per-campaign weekly `refreshedAt` guard.
- **No batching/throttling.** Dispatch eligible campaigns straight to the queue; the agent subagent-concurrency limit bounds load.
- Dispatch at **default** priority. High priority is reserved for user-waiting UI generation (e.g. the initial run while the candidate is in the campaign-story flow).
- **Ships disabled, behind a feature flag.** First validation: a **manual, Claude-assisted run against dev**, ideally on **dummy users that mirror prod** campaigns. Then a **50-campaign cost-analysis batch** before full launch (approval from Bryan).

### 4. Weekly digest (in scope)

The digest surfaces the **top 3 uncompleted** tasks for the week and must match what the tracker shows (same `campaign_task` ordering). Change top-5 to top-3; notify Joe (no change on their end). Because it reads `campaign_task`, it inherits the CAP prioritization automatically.

## Initial generation + triggers

- **Static tasks:** created during onboarding (programmatic). Exact trigger point TBD (Open Question — reviewer).
- **Events + dynamic tasks:** the CAP experiment first runs at **campaign-plan generation** (it needs the plan + story as input), then weekly. Events therefore appear once the plan is generated and are shown consistently in the plan, onboarding, and tracker. This replaces the earlier office-submission events pre-warm.

## API surface

| Method & path | Purpose | Consumers | Change |
|---|---|---|---|
| GET /v1/campaigns/tasks | fetch task rows (static/dynamic/event) | tracker, plan, digest | reused |
| PUT/DELETE /v1/campaigns/tasks/complete/:id | mark (un)complete | tracker | reused |
| GET /v1/campaignStrategy/mine | plan payload; add tracker generation status | webapp | extended |

The `community-events` endpoint and the `community_events` JSON column are superseded by event-type tasks (deprecate/remove — Open Question). No new public endpoints; the cron and the experiment result handler are internal.

## Key Takeaways

- **One CAP experiment**: find up to 3 events (step 1) + prioritize the top-12 tasks (step 2, events included). Replaces the earlier two-experiment design.
- **Everything is a `campaign_task` row** — static, dynamic, and events (`flowType = events`). No `community_events` JSON, no separate store. Plan / onboarding / tracker / digest share one source.
- **Drop `catalog_id` and `priority` columns.** The weekly run replaces generated rows wholesale; priority rides the existing `week`/`date`.
- **No CAP batching** (the subagent limit bounds load). The cron dispatches at **default** priority; high priority is for user-waiting UI runs.
- **Cron ships disabled behind a flag**; validate via a manual dev run + a **50-campaign cost batch** (Bryan approval) before full launch.
- **Digest is in scope**: top-3 uncompleted, matched to the tracker.
- Active is **not** locked; deterministic gates/caps stay in gp-api/webapp.

## Alternatives Considered

- **Two experiments (events + tasks separately).** Rejected (the prior draft): one experiment shares all context, lets the prioritizer promote an event into the weekly set, and is a single dispatch.
- **Store events in `campaign_strategy.community_events` JSON.** Rejected: events could not be marked complete and it created a plan/tracker discrepancy. As tasks they are completable and single-sourced.
- **Keep `catalog_id` / `priority` columns.** Rejected: with wholesale weekly replace and display fields on the row, neither is needed.
- **Batch / throttle the CAP dispatch.** Rejected: the subagent concurrency cap already bounds load.

## Open Questions

1. **Trigger handoff with the campaign-story feature**, and **when static (launch/pre-launch) tasks are created** during onboarding. (Reviewer.)
2. **Phase storage:** does the 4-phase UI need a `phase` column on `campaign_task`, or does grouping collapse to static (pre-launch/launch) vs the weekly-prioritized set?
3. **Cron day/time** relative to the digest send.
4. **Eligibility / who we generate for each week** (future elections; story + plan completed) and **how we handle existing users** (needs tracking). (Reviewer.)
5. **Prompt-quality validation** — who validates, how we evaluate. (Reviewer.)

Resolved during review:
- Up to **3 event tasks** per run (caps events only, not the overall count).
- **Top 12** generated, **top 3** shown, more revealed as tasks are completed.
- Events first appear at **campaign-plan generation** (replaces the office-submission pre-warm).
- **Deprecate** the `community_events` JSON column + the community-events endpoint once events are tasks.

---

# Implementation Notes (relocate to a ClickUp subpage)

Deep detail pulled out of the review doc so the main TDD stays a ~15-minute read.

## CAP engine

Author an experiment in `packages/runbooks/experiments/<id>/` (`manifest.json` + `instruction.md`), publish via `publish_experiments.py`; types generate into `AgentJobContracts`. `ExperimentRunsService.dispatchRun({ type, organizationSlug, clerkUserId, params, priority })` creates an `ExperimentRun` (runId, RUNNING). Partial runs resume; stale runs swept after 45 min; runs observable in `admin/agentRuns`. Use **default** priority for the weekly cron and **high** priority for user-waiting UI generation.

## meeting_briefing precedent (the pattern we copy)

`MeetingBriefingsService.dispatchDailyBriefings` `@Cron('0 7 * * *')` (`gp-api/src/meetings/services/meetingBriefings.service.ts:625`):
- **Multi-pod dedup via DB lease:** `CronLockService` (`src/cron/services/cronLock.service.ts`) — unique `(jobName, runDate)` on `CronRun`; first INSERT wins; 6-hour stale takeover.
- **Result:** `onExperimentRunCompleted` reads the artifact, validates status, and is **fail-closed** (placeholder statuses are not persisted so the next cron retries).

We copy the lease + the result handling, but **not** the batching: meeting_briefing batches 100 with 20-min sleeps; we dispatch straight to the queue and rely on the subagent concurrency cap.

## Weekly cron skeleton

```
@Cron('0 23 * * 0', { timeZone: 'America/Chicago' })   // weekly; day/time TBD vs digest
async dispatchWeeklyRegen() {
  if (!isTrackerCronEnabled()) return          // feature flag; ships disabled
  if (!await cronLock.tryClaimDailyRun('campaignTrackerWeeklyRegen', now)) return
  const campaigns = await selectEligible()     // future election, story + plan done
  for (const c of campaigns) {
    await dispatchRegenIfNeeded(c, now).catch(log)   // no batch/sleep; queue-bounded
  }
  await cronLock.markCompleted('campaignTrackerWeeklyRegen', now)
}
```

`dispatchRegenIfNeeded` gates: skip if `trackerRefreshedAt` is within this week; skip campaigns with no plan/story yet. Dispatch the experiment `mode=weekly` at **default** priority with prior context. New `CronRun` job name `campaignTrackerWeeklyRegen` (reuses the existing table).

## Result + persistence

Reuse `handleAgentExperimentResult`; add an `onExperimentRunCompleted` case for the tracker experiment (mirror `campaignStrategy.onExperimentRunCompleted`):
- Load the artifact from S3, parse against the output schema, persist race-guarded; fail-closed.
- **Replace** the campaign's generated (non-static) `campaign_task` rows with the new top-12 (events as `flowType = events`), assign `week`/`date` from the returned priority order, stamp `trackerRefreshedAt`.

## Experiment instruction.md guidance

- Step 1 (events): real local events only (no generic recurring filler), upcoming window, never invent addresses.
- Step 2 (tasks): personalize copy in the candidate's voice; select/rank from the ~30-task catalog using plan + story + created/completed tasks; an event may be promoted into the top 12; avoid repeating same-type tasks; GOTV reframe in the last 30 days; never invent dates/numbers/compliance.

## Contracts + migration

Add the single tracker experiment's I/O schemas and the ~30-task catalog (the menu) to `@goodparty_org/contracts`. On `campaign_strategy`: add `trackerRunId` + `trackerRefreshedAt` scalars (one experiment, one pair). **Deprecate the `community_events` JSON column** (events move to `campaign_task`). No new `campaign_task` columns. Cross-service change lands in one PR (contracts + gp-api + webapp).

## Webapp consumption

The section keeps its client-side `buildCampaignStrategy` presentation but reads `campaign_task` rows (static + dynamic + event) instead of the bundled catalog's template copy; render personalized copy from the row. The deterministic gates/caps/banner stay in the sequencer. A hook fetches tasks + the tracker generation status (generating/ready).

## Rollout

- Behind a tracker feature flag, **initially disabled**.
- **Validate first via a manual, Claude-assisted cron run against dev**, ideally on dummy users mirroring prod campaigns.
- Then a **50-campaign cost-analysis batch** before full launch; get approval from Bryan.
- Land contracts + gp-api + webapp together. Retire the Gemini events pipeline once events-as-tasks is validated.
- Preview envs have no agent-dispatch queue (`AGENT_DISPATCH_QUEUE_NAME` unset) — generation no-ops there, same as strategic-landscape.

## Testing

- Experiment: manifest schema validation; instruction behavior via the PMF harness (golden inputs -> artifact shape, no-repeat, event-found, no-invented-data).
- gp-api: vitest for the dispatch service (selection/gating), the result callback (parse + fail-closed + wholesale replace + race guard), and the cron lease.
- webapp: sequencer tests for gates/caps; a task-completion round-trip (including event tasks).

## Build order

1. Contracts: the tracker experiment I/O schemas + the ~30-task catalog.
2. Materialize static rows from the catalog during onboarding; wire completion + CTA in the tracker UI; deprecate `community_events` JSON.
3. The tracker CAP experiment (events + top-12) + initial dispatch at campaign-plan generation (high priority) + result persist (wholesale replace).
4. `CampaignTrackerDispatchService` weekly cron (CronLock lease, default priority, no batching), behind the disabled flag.
5. Digest: top-5 -> top-3 from `campaign_task`; notify Joe.
6. Manual dev validation run -> 50-campaign cost batch -> Bryan approval -> ramp.
7. Retire the Gemini events pipeline.
