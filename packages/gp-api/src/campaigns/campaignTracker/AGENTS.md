# campaignTracker/

Campaign Tracker v3 (ENG-10406) backend. Owns the `campaign_tracker_tasks` table
and the lifecycle that fills it: bootstrap at plan completion, the weekly CAP
re-generation, persistence of the agent artifact, and task completion. Feature
overview: `docs/features/campaign-tracker-v3.md`.

## Key files

| File                                          | Role                                                                                                                                                                                                           |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `services/campaignTrackerTasks.service.ts`    | Core. Bootstrap (atomic claim + materialize + dispatch), dispatch params, artifact persistence (append), completion.                                                                                           |
| `services/campaignTrackerDispatch.service.ts` | Thursday `@Cron` weekly re-generation (env-gated, CronLock dedup, active/non-demo cohort); primary-loss gate (tears down outreach + skips).                                                                    |
| `services/staticTrackerTasks.util.ts`         | Builds the static catalog rows **and** the 7 deterministic outreach rows (`buildOutreachTrackerTaskRows`) from `@goodparty_org/contracts` at bootstrap; owns the ballot-stage read (`needsBallotAccessTasks`). |
| `campaignTracker.controller.ts`               | `/campaigns/tracker-tasks` GET (also an `@McpTool`) + complete/uncomplete + skip/unskip + `POST generate` (non-prod manual override).                                                                          |
| `schemas/trackerTaskResponse.schema.ts`       | `@ResponseSchema` for the GET (required for the MCP tool).                                                                                                                                                     |
| `campaignTracker.consts.ts`                   | Experiment type, cron job name, `CHANNEL_TO_FLOW_TYPE` (the canonical map).                                                                                                                                    |

## Patterns / non-obvious logic

- **Tasks are dated on the campaign's timeline.** `resolveTrackerTaskDate` and
  `campaignPhaseWindows` (contracts' `CampaignTimeline.ts`) turn a catalog
  task's timing into a date inside its phase's window, counted back from the
  election. Rows dated before that, or before the candidate changed their
  race, are moved on read: `alignTrackerTaskDates` runs (best-effort) before
  the GET returns, on open default rows whose timing is signup-relative,
  and on the voter-contact sends. A send still ahead keeps its
  election-relative date; a late joiner's sends already past at the start
  are compressed into the time before the next one (`voterContactSendDate`),
  and the plan document uses the same rule. The CAS outreach post reads these
  row dates, so a new Pro campaign's ClickUp tasks match; one already posted
  keeps the dates it was sent with. Other election-relative rows (the GOTV
  dates) are never moved.

- **Skipping is not completing.** `PUT /skip/:id` records why the candidate set
  a task aside: `later` sets `snoozedUntil` (`trackerTaskSnoozeUntil`: three
  days, or the due date when that comes first), `notForMe` holds until
  `DELETE /skip/:id`. Required tasks (`canSetTaskAsideForGood`: ballot access,
  compliance, the final report) 400 on `notForMe`. Neither touches `completed`,
  so a skipped task still counts as open work everywhere that reads completion;
  only the webapp's next-task pick passes over it (`isTrackerTaskSetAside`).

- **Append, never replace (the central rule).** `onExperimentRunCompleted`
  stamps each run's rows with `week = max(existing dynamic week) + 1` and never
  deletes prior generations. This preserves completion across weekly re-runs and
  keeps history for the weekly agent's prior-task lookup. Consequence: every
  reader must scope to the latest generation. The frontend (`buildTrackerStrategy`)
  and the digest (`weeklyTasksDigestHandler`, a separate `latest_gen` CTE) both do.
- **Bootstrap is claimed atomically, and is not gated on the campaign story.**
  `bootstrapTrackerIfPlanComplete` (in `campaignStrategy.service.ts`) proceeds
  as soon as both plan sections persist. The story is input that sharpens the
  tasks, not a precondition — a campaign with no story row gets the same
  generic rows. Two plan sections complete on independent SQS messages, so
  `bootstrapForCampaign` claims `CampaignStrategy.trackerBootstrapped` with one
  conditional `updateMany` (false->true); only the winner materializes +
  dispatches, and the claim is released on failure so a later trigger retries.
- **Static rows materialize eagerly, at plan-generation start.**
  `getOrGenerateStrategicLandscape` calls `materializeStaticTasks`
  (best-effort) so the static checklist + outreach render immediately, without
  waiting for the SQS-driven completion bootstrap (which never fires in local
  dev). The dynamic `dispatchGeneration` still runs only from the completion
  bootstrap (it needs the finished plan). `materializeStaticTasks` is idempotent
  and race-safe via a per-campaign `pg_advisory_xact_lock`
  (`TRACKER_STATIC_TASKS_ADVISORY_LOCK_KEY`), because the plan endpoint is polled
  and the count-check alone isn't atomic, so the eager call and the bootstrap
  call can't double-insert the catalog.
- **The story task mirrors story state through its completion, not its
  existence.** The catalog's `Campaign story` category
  (`CAMPAIGN_STORY_CATEGORY` in contracts) holds one `static` task, materialized
  for every campaign and never deleted. `completed` tracks whether the Campaign
  Story is finished, in both directions:
  `reconcileCampaignStoryTask` (same advisory lock as the ballot-access
  reconcile, called from `dispatchGeneration`) ticks it when the story is
  complete and reopens it when the story is emptied again, so the row can never
  disagree with the card pinned above the rail. The row is the record of the
  work; making it vanish would lose that.
- **The tracker read ticks it too.** The story is finished on other surfaces —
  the story page, the manager chat — so `completeCampaignStoryTaskIfDone` runs
  on `GET /campaigns/tracker-tasks` and closes the task there rather than
  leaving the list stale until the next generation. It is the open->complete
  direction only, and it short-circuits on an indexed count when the row is
  already ticked, so polling the list does not pay for a story read it cannot
  use. The full reconcile still owns the reverse.
- **It sits early in Launch.** `phase: 'preLaunch'` with `preLaunch` timing,
  which resolves a week past the timeline's start. `buildCampaignStoryTrackerTaskRows`
  exists separately from `buildStaticTrackerTaskRows` only because the row
  carries `link`/`cta`, which the catalog schema does not model. When the
  reconcile re-adds it to a campaign materialized long ago it recovers that
  campaign's original anchor from its earliest pre-launch row rather than
  taking a fresh one, so the row lands with its siblings instead of a week out
  from today.
- **Ballot access is gated on the candidate's ballot stage.** The catalog's
  `Ballot access` category (`BALLOT_ACCESS_CATEGORY` in contracts) is dropped at
  materialization for a candidate who answered onboarding's "Are you already on
  the ballot?" with `on-ballot`. Every other answer keeps it, including `testing`
  and a missing answer — an absent answer is not evidence they filed, and a
  missed filing window can't be undone. The answer is read off the
  `campaign.ballotStatus` column via `parseBallotStatus`, so an unrecognised
  value also reads as unanswered. Because static rows
  materialize once, `reconcileBallotAccessTasks` re-reads the _current_ answer on
  every generation (bootstrap, weekly cron, manual) and immediately after a
  campaign update changes `ballotStatus` (`CampaignsService.updateJsonFields`,
  best-effort), and adds or deletes those rows to match, under the same
  advisory lock as `materializeStaticTasks`. These
  tasks are `type: 'static'`, so they are absent from the dynamic CAP menu and
  the agent can never re-surface them.
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
- **A past election date anchors nothing.** `resolveElectionDate` takes the
  general date, falls back to the primary, and ignores whichever has already
  passed; with no upcoming date `buildOutreachTrackerTaskRows` emits **no**
  outreach rows (never a `start`-anchored fallback). The reason: a returning
  candidate's campaign row keeps last cycle's `electionDate` until they update
  their race, and static rows are one-shot, so rows dated off it would survive
  the fix and post a finished schedule to CAS on Pro upgrade. Upstream,
  `getOrGenerateStrategicLandscape` refuses (400) to generate at all for a past
  `electionDate`, before `materializeStaticTasks` runs.
- **Manual generation is non-prod only.** The weekly cron
  (`CAMPAIGN_TRACKER_AUTOMATION_ENABLED='true'`) runs in prod only, so dev/qa
  never generate on their own. `POST /campaigns/tracker-tasks/generate` →
  `CampaignTrackerTasksService.generateNow` lets a candidate dispatch a run for
  their own campaign there. It reuses `dispatchGeneration` but deliberately
  skips the cron's `CronLock` lease + weekly coverage dedup (re-fireable on
  demand), and picks mode the same way the cron would (`initial` with no prior
  dynamic generation, else `weekly`). The controller gates on the fail-closed
  `IS_NON_PROD_DEPLOY`, so the route 404s in prod (and on any unexpected env
  value) — prod behavior is unchanged.
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
- **Pro upgrade posts the upcoming week (Pro only).** `notifyProUpgrade` posts
  the upcoming Mon-Sun week via the same `nextMondayUtcMidnight` anchor the tasks
  are dated to (a current-week window would miss them, since static rows and every
  generation target the upcoming week). Routed from
  `CampaignTasksService.notifySlackOnProUpgrade` for tracker-cohort campaigns. All
  three Slack messages share `postCampaignWeekToSlack` + the casClickupTasks
  channel; every one is Pro-gated.
- **The outreach schedule posts once, in the legacy plan-created format.**
  `postOutreachScheduleOnce` (called after the week post on generation and on
  Pro upgrade) sends the full text/robocall schedule as
  `:white_check_mark: *AI Campaign Plan Created*` with `(Due: MMM d, yyyy)`
  dates — the exact shape the ops-owned Zapier automation parses into ClickUp
  voter-contact tasks (it ignores the week posts). One-shot via the
  `campaignStrategy.outreachSlackPostedAt` claim, released on a failed send.
  Don't change the message format without coordinating with CAS/ops.
- **CAS post dates are formatted from UTC parts** (`formatInTimeZone(...,
'UTC', ...)`): stored task dates are UTC-midnight instants, and a process
  west of UTC would render them a day early with plain `format`. Outreach send
  offsets come from `VOTER_CONTACT_SCHEDULE` in contracts — shared with the
  plan document's Voter Contact Plan section so all surfaces show identical
  dates.
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
- The digest is a _separate_ consumer of this table; a change to what counts as
  "current" must be mirrored in `weeklyTasksDigestHandler.service.ts`.
- **The digest mirrors the week view: dynamic + deterministic outreach.**
  `fetchTrackerDigestRows` surfaces the latest dynamic generation **plus** the
  deterministic text/robocall outreach dated in the window
  (`(is_default_task = false AND week = latest generation) OR (is_default_task =
true AND flow_type IN (text, robocall))`), matching what `buildActiveWeeks`
  shows for a week (dynamic-latest-gen + `isDefaultTask` outreach). The static
  setup checklist (non-outreach default rows) is **not** emailed. Two subtleties:
  the dynamic branch needs `is_default_task = false` alongside `week = g.gen`
  because a default row's calendar-offset `week` can coincidentally equal the
  latest generation index; and it is a `LEFT JOIN latest_gen` so a campaign with
  outreach dated in the window still surfaces if its dynamic generation is
  momentarily absent. Outreach ranks ahead of the dynamic picks.
