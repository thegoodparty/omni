# Campaign Tracker v3 (ENG-10406)

Renders a candidate's campaign plan as phased, dated, prioritized **weekly
tasks plus local events**. Static checklist tasks come from a fixed catalog and
appear immediately; the personalized half (which dynamic tasks to surface this
week, plus real local events) is produced by a weekly CAP agent experiment and
persisted as task rows the candidate can check off.

Spans four packages: `gp-api` (data model, bootstrap, weekly cron, digest, MCP
tool), `gp-webapp` (the Campaign Plan rendering), `packages/runbooks` (the CAP
experiment), and `@goodparty_org/contracts` (the task catalog + experiment I/O).

## Background

Before this, the campaign plan and the weekly task list ran on two separate
pipelines that never read each other, so candidates saw generic recurring
filler instead of tasks driven by their own race (only about 4 of roughly 12
mappable plan inputs reached the task list). Campaign Tracker v3 replaces the
generic task generator with a plan-driven sequencer over a hand-authored,
closed catalog (~31 static plus ~27 dynamic tasks across priority tiers). The
**7 outreach sends** (text + robocall) are materialized deterministically from
the plan's general-election contact schedule; they are never agent-selected.
The remaining ~20 dynamic tasks are selected, ranked, and voiced per candidate
by the agent, which voices task copy and finds events only; it never invents
the task list, dates, numbers, or compliance steps.

The epic (ENG-10406) is structured as: ENG-10407 plan-to-tracker data contract
(the keystone), ENG-10408 phase sequencer, ENG-10409 pills engine (deterministic
parameterization plus the LLM copy pass), ENG-10410 gamified progress tracker +
contact recording, ENG-10411 weekly prioritization ranker, and ENG-10412 tracker
UI + analytics (`Win - Tracker Viewed` / `Win - Task Completed` / `Win - Phase
Advanced` on Amplitude). The voter-contact and fundraising progress thermometers
(ENG-10410) are part of the epic but may ship later (fundraising is gated on a
donation processor).

## What the candidate sees

The Campaign Plan page (`/dashboard/campaign-plan`) shows a four-phase rail:
**Pre-launch, Launch, Active campaign, Get out the vote**. Each phase holds
dated task cards the candidate works through and marks complete.

- **Static tasks** (the launch / pre-launch checklist) and the **7 outreach
  sends** render the moment the tracker is bootstrapped, so there is something
  to do immediately.
- **Dynamic tasks and events** land a few minutes later when the first agent
  run completes. While they generate, a banner says so.
- **Pre-launch and Launch** show **all** of their tasks at once. The **Active
  campaign** phase is a **week navigator**: one Monday-Sunday week at a time,
  with controls to step one week back (to review) or one week forward (next
  week's plan, once that Thursday's generation lands), but no further.
- GOTV tasks stay hidden behind a window message until the election is within
  **30 days**.
- If the candidate **loses their primary**, the outreach sends disappear and no
  further weekly generation runs (the race is over).
- A **Monday digest** emails the candidate their top 3 uncompleted tasks for
  the week (the digest still caps at 3; only the page shows all).

## Lifecycle (coexists with the legacy path, gated on campaign story)

The tracker is the **campaign-story cohort's** experience. It takes the campaign
story (why / background / issues) as input, so it only exists once a campaign
goes through Campaign Story. The legacy `campaign_task` path is fully preserved
for the story-off cohort. This is deliberately **not** a hard flip, so the
branch is safe to ship to prod while `campaign-story` is still gated there.

Story cohort (`campaign-story` on):

1. Candidate completes **Campaign Story** (why / background / issues).
2. **Campaign Plan** generates (the `campaignStrategy` opposition + opportunity
   sections, with the story as input). When both sections persist **and a
   `campaign_story` row exists**, the tracker bootstraps.
3. **Bootstrap** materializes the static rows plus the 7 deterministic outreach
   sends, and dispatches the first CAP run.
4. Each **Thursday** (once the weekly cron is enabled) a CAP run re-prioritizes
   the upcoming Monday-Sunday week and refreshes events. The Thursday cadence
   gives the downstream ClickUp email automations ~3 days to fire before Monday.

Story-off cohort (legacy, = prod today): no campaign story, so the plan still
generates but the tracker never bootstraps. The candidate keeps the legacy
onboarding success page, the dashboard `campaign_task` list, the
`community_events` JSON column, and the legacy weekly digest, exactly as before
the tracker shipped.

Two gate signals:

- the **`campaign-story` flag** gates routing + which UI surfaces render
  (post-pledge route, dashboard task slot, campaign-plan page layout);
- **`campaign_story` existence (data)** gates the tracker bootstrap, so the
  tracker can't materialize for a campaign that never wrote a story regardless
  of flag state.

Because those two signals can disagree — an account flagged on but with no (or
an incomplete) story, e.g. one that generated a plan **before** the flag was
turned on — the **campaign-plan router also gates the UI on story completeness**,
not just the flag. `CampaignPlanRouter` reads `useCampaignStoryComplete` (bio +
`background` + at least one issue) and, for the story cohort, shows the
plan/tracker only once the story is complete; an incomplete story is routed to
the existing "finish your Campaign Story" gate (`CampaignPlanStoryGate`) instead
of a tracker stuck on "setting up" forever. This keeps the frontend gate aligned
with the bootstrap's data gate.

## Data model

One table, `campaign_tracker_tasks` (`prisma/schema/campaignTrackerTask.prisma`),
whose schema mirrors the legacy `campaign_task` plus a `phase` column, so the
completion / CTA / update-history machinery is reused against it.

| Field | Meaning |
|-------|---------|
| `isDefaultTask` | `true` = deterministic row (static catalog **or** outreach send); `false` = agent-generated dynamic task or event |
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
plan sections have persisted **and the campaign has a `campaign_story` row**
(the story-data gate, so story-off plans complete but never bootstrap), then
calls `CampaignTrackerTasksService.bootstrapForCampaign`:

1. **Atomic claim.** A single conditional update flips
   `CampaignStrategy.trackerBootstrapped` `false → true`. The two plan sections
   complete on independent SQS messages (possibly different pods), so only the
   writer that wins the claim proceeds; the loser no-ops. This prevents
   double-materialize / double-dispatch. If the work then throws, the claim is
   released so a later trigger can retry.
2. **Materialize static rows** from the contracts catalog
   (`staticTrackerTasks.util.ts`), anchored to the upcoming Monday, plus the **7
   outreach sends** (`buildOutreachTrackerTaskRows`) dated against the general
   election (skipped entirely if the primary was already lost; see below).
3. **Dispatch** the initial CAP run (`mode = initial`, high priority).

**Static rows are also materialized eagerly, at plan-generation start.**
`getOrGenerateStrategicLandscape` calls `materializeStaticTasks` (story-gated,
best-effort) as soon as plan generation is requested, so the static checklist +
outreach render immediately, without waiting for the CAP-completion bootstrap
above (which is SQS-driven and, notably, never fires in local dev). The dynamic
`dispatchGeneration` still happens only from the completion bootstrap, since it
needs the finished plan as context. `materializeStaticTasks` is idempotent and
race-safe (a per-campaign `pg_advisory_xact_lock`, since the plan endpoint is
polled), so the eager call and the bootstrap's call can't double-insert; whichever
runs first wins and the other no-ops.

### Deterministic outreach and primary-loss suppression

The **7 outreach sends** (4 texts + 3 robocalls) are the only text/robocall
tasks the tracker ever surfaces. They are **not** agent-selected: they are the
catalog's `channel ∈ {text, robocall}` entries, materialized at bootstrap with
`isDefaultTask = true` and dated `electionRelative` to the **general** election
(intro 4 weeks out, persuasion 2 weeks out, plus the GOTV early-vote and
election-day sends). Because they are deterministic, the catalog attachment the
agent sees **excludes** them, and `onExperimentRunCompleted` also drops any
`text`/`robocall` rows the model emits anyway (defense in depth).

A campaign that **loses its primary** has no general election to run, so the
outreach must stop. The source of truth is split: the **primary result** comes
from HubSpot (`Lost Primary` → `campaign.primaryResult === 'lost'`); the primary
date / existence comes from BallotReady. The weekly cron checks
`primaryResult === 'lost'` **before** generating; if lost it calls
`removeOutreachTasks` (deletes the `isDefaultTask` text/robocall rows) and skips
the run. The check lives in the weekly dispatcher, not bootstrap, because the
loss is usually recorded after the tracker (and its outreach) already exists.

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
  generator emits only the ~20 agent-selectable dynamic tasks: it filters to
  `type === 'dynamic'` **and excludes** the `text`/`robocall` outreach (those
  are deterministic). The runner drops it at `/workspace/task_catalog.json`.
- **Prior tasks + completion** are fetched live (weekly mode) via the MCP tool
  `GET /v1/campaigns/tracker-tasks` (`@McpTool` on the tracker controller), so
  the agent sees what it generated before and what the candidate finished.

Output: up to **12** prioritized tasks plus up to **3** real local events, drawn
from the ~20 non-outreach dynamic catalog (no text/robocall). The model selects,
ranks, personalizes, and finds events; it does **not** set gates, caps, or the
outreach schedule. The GOTV 30-day window and the Active-phase week navigator
stay deterministic in gp-api / webapp.

`onExperimentRunCompleted` loads the artifact, drops any `text`/`robocall` rows
(those are deterministic), computes the next generation index, and **appends**
the rest (events keep their real date; dateless tasks dated across the upcoming
week). Fail-closed: a bad artifact marks the run failed and rethrows.

After the rows commit, `notifyTasksGenerated` posts the upcoming Monday-Sunday
week's tasks to the `casClickupTasks` Slack channel for **Pro** candidates,
mirroring the legacy campaign-plan message. It fires for **both** the initial
bootstrap (generation 1, "first week" title) and every weekly regen ("weekly"
title). The list is what the candidate sees for the week (latest generation's
dynamic tasks plus any deterministic outreach/static tasks due that week). It is
best-effort: a Slack failure is logged but never fails the run (the rows are
already persisted). Lost-primary campaigns never reach here: the weekly cron
skips dispatch for them, so no run completes and nothing posts. Every Slack
notification in the tracker is **Pro-only**.

### Weekly regeneration

`CampaignTrackerDispatchService.dispatchWeeklyRegen` (`@Cron` Thursday 9am
Central), gated by the `CAMPAIGN_TRACKER_AUTOMATION_ENABLED` env flag (ships
disabled). It uses a `CronLock` lease for multi-pod dedup, selects active,
non-demo campaigns that already have tracker rows, and skips any campaign with
a non-failed run in the last 6 days (a failed run is ignored so a stuck week
retries). For each campaign it first checks `primaryResult === 'lost'`: if lost
it tears down the outreach rows (`removeOutreachTasks`) and skips generation
entirely; otherwise it dispatches `mode = weekly` at default priority. It runs
Thursday (not Sunday) so the downstream ClickUp email automations have ~3 days
to fire before the Monday digest; tasks are still displayed Monday-Sunday.

### Weekly digest

`weeklyTasksDigestHandler.service.ts` serves **both cohorts** from one trigger,
routed per campaign:

- **Tracker cohort** (`fetchTrackerDigestRows`): reads `campaign_tracker_tasks`
  and mirrors the tracker's week view: the **latest dynamic generation** plus the
  **deterministic text/robocall outreach** dated in the window
  (`(is_default_task = false AND week = latest generation) OR (is_default_task =
  true AND flow_type IN (text, robocall))`). The static setup checklist
  (non-outreach default rows) is excluded, since it renders in the
  Pre-launch/Launch/GOTV-ops sections rather than the active week the digest
  promotes. Outreach ranks ahead of the dynamic picks. Also excludes GOTV tasks
  until the election is within 30 days (matching the UI), and excludes inactive /
  demo campaigns.
- **Legacy cohort** (`fetchLegacyDigestRows`): the unchanged pre-tracker digest
  over `campaign_task`, guarded by `NOT EXISTS (campaign_tracker_tasks)` so a
  migrated campaign isn't double-counted. The two cohorts are mutually
  exclusive, so each campaign gets exactly one digest.

Both email the **top 3 uncompleted** tasks dated in the upcoming Monday-Sunday
window. Election date falls back to `primaryElectionDate`.

## Key files

The two feature directories carry their own `CLAUDE.md` with module-level logic
and gotchas. Read those first when working in the code:

- `packages/gp-api/src/campaigns/campaignTracker/CLAUDE.md` (backend): bootstrap
  (atomic claim), the append/generation model, weekly dispatch, persistence,
  completion.
- `packages/gp-webapp/app/dashboard/campaign-plan/components/campaignStrategy/CLAUDE.md`
  (frontend): latest-generation rendering, phase status, the GOTV window gate,
  polling, the date-format gotcha.

The table below is the cross-package file index:

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
  now" (active) phase is **date-driven**. Pre-launch / Launch show all of their
  tasks; GOTV is gated to the final 30 days. The **Active** phase is built
  separately by `buildActiveWeeks`, which buckets every active task (all
  generations, not just the latest) into Monday-Sunday weeks and flags the week
  containing today; `CampaignStrategyPhase` renders it as a navigator bounded to
  the current week ±1. Dates are parsed at **local** midnight (matching the date
  chip) so a UTC-midnight task can't land in the wrong calendar week.
- `useTrackerTasks.ts` polls fast (20s) while dynamic tasks are still
  generating, then drops to a slow background poll (so a weekly regen is picked
  up) with a fast-poll budget cap.
- `CampaignStrategySection.tsx` renders only from persisted tracker rows
  (loading / error / a "setting up your tracker" state while bootstrap is in
  flight, then the accordion). There is **no** client-side catalog fallback.
  The section is rendered only for the story cohort (`CampaignPlanView` branches
  on the `campaign-story` flag), so a no-rows state means bootstrap hasn't
  landed yet, not "legacy campaign with no tracker."
- `CampaignPlanView.tsx` is the cohort switch on the campaign-plan page: story
  cohort gets the tracker hero + `CampaignStrategySection` above the plan;
  story-off gets the legacy plan content (strategic landscape, **community
  events**, voter insights) with no tracker. It gates the legacy
  community-events poll (`useCampaignPlanData(_, communityEventsEnabled)`) off
  for the story cohort.

## Rollout and ops

- **Weekly cron:** `CAMPAIGN_TRACKER_AUTOMATION_ENABLED=true` (env) turns on
  Thursday regeneration. Ships disabled.
- **Flow gating:** the `campaign-story` flag is the master switch for the new
  flow (routing, dashboard task slot, campaign-plan page layout); `campaign_story`
  existence gates the bootstrap. Story-off is a fully usable legacy fallback
  (success page, legacy dashboard tasks, legacy digest), so the flag can ramp
  safely and the branch is safe to merge while `campaign-story` is off in prod.
  `campaign-strategy` gates the campaign-plan page itself.
- Cost is roughly $0.94 per candidate per run (validated on dev cohorts;
  approved by Bryan).
- Preview envs have no agent-dispatch queue, so generation no-ops there.

## Teardown (when campaign-story is fully ramped)

Everything in this section exists **only** to keep the story-off (pre-tracker)
experience working during coexistence. Once `campaign-story` is ramped to 100%
in prod and the legacy cohort is empty, remove it. This is the checklist for
that cleanup PR.

**gp-api**

- **Digest:** delete `fetchLegacyDigestRows` and the
  `NOT EXISTS (campaign_tracker_tasks)` guard in
  `weeklyTasksDigestHandler.service.ts`; the handler collapses back to the
  single tracker query (and its unit/integration tests for the legacy cohort).
- **Legacy generator:** `campaignTasks.service.ts → generateDefaultTasks` and
  the `@Sse('generate/stream')` controller route, once nothing calls them.
- **Community events backend:** the `communityEvents` service / persister /
  prompts / schema, the `POST /campaignStrategy/mine/community-events` route,
  and the `campaign_strategy.community_events` JSON column (a migration).
- **`campaign_task` table** itself, after confirming no remaining readers
  (completion history, exports, analytics).
- **Slack:** `notifySlackDefaultTasksCreated` / `notifySlackOnProUpgrade` /
  `sendCampaignPlanSlackMessage` in `campaignTasks.service.ts`. See the known
  gap below first.

**gp-webapp**

- **Routing:** collapse `resolvePostPledgeRoute` to always
  `/dashboard/campaign-story` (drop the success-page and dashboard branches).
- **Onboarding success page:** the `/onboarding/success` tree and its
  community-events pieces (`useCommunityEvents`, `planContent` `civicEvents`, the
  PlanSections Community Events subsection, the PDF Community Events table, the
  SuccessPage events wiring), plus the `prewarmCommunityEvents` call in
  `OnboardingFlow`.
- **`useCampaignPlanData`:** drop the `communityEventsEnabled` param (always
  off once there is no legacy cohort).
- **`CampaignManager`:** drop the story-off branch and `LegacyDashboardTasks`
  (and the then-unused `useTaskGenerationStream`, `TasksList`, `LoadingState`,
  `FailedToGenerate`, `EmptyState` if nothing else imports them).
- **`CampaignPlanView`:** drop the story-off (legacy plan) branch and render the
  tracker unconditionally.
- **Flag reads:** remove `campaign-story` gating from `CampaignPlanRouter`,
  `CampaignPlanView`, `CampaignManager`, `DashboardMenu`, and `OnboardingFlow`.

**Flags:** retire the `campaign-story` flag in Amplitude (and revisit
`campaign-strategy`) once the UI no longer reads it.

### Slack notifications (all Pro-only, all to `casClickupTasks`)

Three triggers post the relevant week's tasks to the CAS channel for **Pro**
candidates, all mirroring the legacy campaign-plan message format:

- **Generation** (`notifyTasksGenerated`, in the completion handler above):
  fires on the initial bootstrap (generation 1, "first week" title) and every
  weekly regen ("weekly" title), posting the **upcoming** Mon-Sun week.
- **Pro upgrade** (`notifyProUpgrade`): when a tracker campaign upgrades to Pro,
  posts the **upcoming** Mon-Sun week's tasks (the same `nextMondayUtcMidnight`
  anchor the tasks are dated to) so CAS can start immediately. Routed from
  `notifySlackOnProUpgrade`: tracker-cohort campaigns (which have
  `campaign_tracker_tasks` and no legacy default tasks) get this message; legacy
  campaigns keep the plan-summary message. The existing `proUpgradeSlackNotifiedAt`
  stamp is shared, so a campaign is announced once regardless of cohort.

- **Outreach schedule, once per campaign** (`postOutreachScheduleOnce`): after
  the week post on both triggers above, the full deterministic text/robocall
  schedule is posted in the legacy `AI Campaign Plan Created` format with
  `(Due: MMM d, yyyy)` dates. The ops-owned Zapier automation that creates the
  ClickUp voter-contact tasks filters the channel on exactly that message
  shape (it ignores the Mon-Sun week posts), so this is the message that
  actually feeds ClickUp for tracker-cohort candidates. One-shot via a
  `campaignStrategy.outreachSlackPostedAt` claim (released on a failed send so
  the next trigger retries). Skipped when no outreach rows exist (lost
  primary).

All are best-effort (a Slack failure is logged, never fails the caller) and
Pro-gated. Dates in every CAS post are formatted from UTC parts
(`formatInTimeZone(..., 'UTC', ...)`) — stored task dates are UTC-midnight
instants, and a process west of UTC would otherwise render them a calendar day
early. The legacy `notifySlackOnProUpgrade` / `notifySlackDefaultTasksCreated`
plan-summary path stays for the legacy cohort until the legacy-Slack cleanup task
retires it.

### Outreach send timing is shared with the plan document

The 7 sends' offsets live in `VOTER_CONTACT_SCHEDULE`
(`@goodparty_org/contracts`, `VoterContactSchedule.data.ts`): intro text E-56,
intro robocall E-49, persuasion text E-35, persuasion robocall E-28, early-vote
text E-14, reminder robocall E-1, reminder text on election day. The catalog's
outreach `timing` entries and the plan document's Voter Contact Plan section
(gp-webapp `planContent.ts`) both derive from it, so the plan doc, the tracker
week view, and the ClickUp feed always show the same dates. Change the cadence
there, nowhere else.

## How this diverged from the original TDD

The design doc (`scratch/campaign-tracker-v3/`, since removed) proposed
coexistence with the legacy tracker and a weekly **wholesale replace** of
dynamic rows. One of those held; the other changed:

1. **Coexistence, gated on campaign story.** An earlier iteration hard-flipped
   (retired the legacy `campaign_task` generation + display). That was reverted:
   because `campaign-story` is still gated in prod and dev auto-merges to prod
   daily, the off state must remain a fully usable legacy experience. So the new
   tracker is the story cohort's path, the legacy path is preserved for
   story-off, and routing/digest/UI cohort-split per campaign on the
   `campaign-story` flag + `campaign_story` existence.
2. **Append, not replace.** Wholesale-replace wiped completion every week and
   kept no history for the agent. The append model preserves both, at the cost
   of every consumer scoping to the latest generation.
3. **Outreach is deterministic, not agent-selected.** The original design let
   the agent pick text/robocall sends like any other dynamic task. They are now
   the 7 fixed sends from the plan's general-election contact schedule,
   materialized at bootstrap and suppressed on a lost primary. This keeps the
   compliance-sensitive outreach cadence out of the model's hands. The Active
   phase also moved from a flat list to a one-week-at-a-time navigator (current
   week ±1), and weekly generation moved from Sunday to Thursday.
