# Campaign Tracker v3 — existing work and event/task generation context

Research notes mapping the Campaign Tracker v3 epic onto the existing codebase,
with a focus on what is already built that facilitates task and event
generation (the `weeklyTasksDigest` service) and how it relates to the runbooks
/ PMF experiments system.

> **Current design (June 22) — read the TDD first.** The authoritative design now
> lives in the TDD: repo `scratch/campaign-tracker-v3/campaign-tracker-tdd.md` and
> ClickUp (Eng Docs → Win Docs → Technical Design Docs). Several sections below
> predate review reversals; where they conflict, **the TDD wins.** Key changes:
> **one** CAP experiment (find up to 3 events, then prioritize the top 12 tasks
> with events among them), **not two**; events and all tasks are **`campaign_task`
> rows** (`flowType = events`), **not** `campaign_strategy.community_events` JSON;
> the initial run is at **campaign-plan generation** (it needs plan + story),
> **not** an office-submission pre-warm; **no `catalog_id` / `priority` columns**;
> **no CAP batching**; the cron ships **disabled behind a flag** (manual dev run →
> 50-campaign cost batch → Bryan approval). The weekly digest is in scope.

## Sources

- One-pager (ClickUp doc): Campaign Tracker (v3?) —
  https://goodparty.clickup.com/90132012119/v/dc/2ky4jq2q-103793/2ky4jq2q-86673
- Companion doc on the same page: Campaign Plan v2 — Fast Follows & Improvements
  (doc `2ky4jq2q-103793`, page `2ky4jq2q-84333`)
- Epic (ClickUp ticket): ENG-10406 Campaign Tracker (v3) —
  https://goodparty.clickup.com/t/90132012119/ENG-10406
- Prototype (Lovable, public, no login): https://snuggle-nav-kit.lovable.app
  Linked from both the one-pager ("Lovable:") and the epic ("Prototype:").
  The campaign plan itself has no nav tab in the prototype; reach it directly at
  https://snuggle-nav-kit.lovable.app/campaign-plan. Screenshots in the
  Prototype section below.

---

## The goal

Render the candidate's campaign plan as personalized, dated, prioritized tasks
across the full campaign lifecycle on `/dashboard`. Today the plan and the
weekly task list run on two separate pipelines that never read each other, so
the candidate sees generic recurring filler instead of their own race. Of
roughly 12 mappable plan inputs, only about 4 reach the task list today. The
epic replaces the generic task generator with a plan-driven sequencer.

Scope numbers moved across three artifacts. The xlsx (`campaign-tasks-master`,
the build inventory we now refactor against) is the current source of truth:

- One-pager: 70 tasks (31 live / 39 proposed); 56 content-pill / 7 generated /
  7 static.
- Epic ENG-10406: 62 cards (22 live / 40 proposed); 48 / 7 / 7. The epic itself
  flags the one-pager as unsynced.
- xlsx (latest): 58 tasks (22 live / 36 proposed). By the Tasks-sheet `Type`
  column (the current global-vs-personalized split): **31 Static / 27 Dynamic**.
  Tiers P1×24, P2×20, P3×9, P4×5. (The old Overview tab's "51 Dynamic / 7 Static"
  was the personalization-based count and is superseded — see the redefinition
  below.)
- 9 progress milestones moved out of cards into a gamified thermometer
  (consistent across all three).
- Analytics on Amplitude (`Win - Tracker Viewed`, `Win - Task Completed`,
  `Win - Phase Advanced`).

Accuracy note: generated-per-item dropped from 7 (epic) to 3 (xlsx). The current
generated-per-item tasks are letters-to-the-editor (press outlets), attend a
community event (civic events), and attend the local related-office meeting.
Opponents are NOT generated-per-item in the xlsx — opponent monitoring is a
content-pill task.

Build shape: one keystone (plan-to-tracker data contract) plus four pillars
(phase sequencer, pills engine, gamified progress tracker + contact recording,
weekly prioritization ranker), plus the Tracker UI surface.

---

## V0 direction (from meeting notes)

Latest direction from the project discussion. Where this conflicts with the
one-pager, treat this as the current call.

Superseded in part — read with the "Task catalog refactor plan" below. These
meeting notes said V0 would be "deliberately static" with "no AI personalization."
The direction has since evolved: the task CATALOG is still hand-authored and
closed (AI does not invent the task list), but the latest call adds an LLM call
to personalize the COPY of dynamic tasks. So "static" now means the catalog, not
the copy. This is a scope change from both the ClickUp docs (which defer Layer 3
model-written copy to v2) and these notes — flagged as an open product question
below.

Project goals:

- Merge the current task list with the campaign plan so the plan shows as
  actionable progress.
- Prioritize roughly 70 tasks and surface only 3 to 4 hyper-relevant tasks to
  each user per week.

Task implementation strategy:

- Static vs AI tasks: V0 uses a closed list of static tasks (including community
  events), not unconstrained AI-generated personalization. AI-driven task
  generation is reserved for future phases.
- Task prioritization: implement P1 and P2 priority levels to filter which tasks
  surface to the user.
- Future AI: integrate the AI Chief of Staff into the AI Campaign Manager in a
  later phase.

Development and technical workflow:

- Ownership: Danny owns the campaign plan; Felix owns the "my story" feature
  (the prototype's "Tell us your story" link). They support one another's work.
- The Lovable prototype is the design source of truth.
- Feature flag: clean up and delete the existing "campaign manager" feature flag
  rather than repurpose it, to ensure a fresh experience.
- Data and taxonomy: build a structured taxonomy for event types (community
  events, farmers markets, etc.) in the project spreadsheet.
- Code and maintenance: review the weekly task digest service and existing
  runbooks to understand the task generation logic.

Direction update: generate ALL of a candidate's catalog tasks up to the election
upfront, in one pass — no cron for task generation (the sequencer dates every
task in one client-side pass). The exception is community events: we want real,
customized, district-specific events across the whole campaign, which a grounded
search can only surface near-term, so those DO use a weekly cron that accumulates
events over time. See "Community events coverage (weekly cron)" below.

What this means for the existing code:

- A closed static list, P1/P2 filtering, and weekly surfacing of the top 3 to 4
  is almost exactly the `weeklyTasksDigest` shape today: static `campaign_task`
  rows, a SQL ranker that orders and caps, and a weekly cron. The digest is the
  closest working template for V0, more so than the AI/experiment path.
- Task generation: the static Pre-launch/Launch tasks are generated upfront, no
  cron. The dynamic (CAP) tasks and community events are generated when the user
  first opens the tracker / finishes setup, then re-generated by a weekly cron
  that only touches previously-generated items (see the June 17 model below).
- AI/experiment-driven task generation (binding runbooks/PMF experiment output
  into tasks) is explicitly a future phase, not V0. The "missing wire" described
  later in this doc is a v2+ concern; V0 does not need it.

---

## Build model and decisions (June 17, 2026 meeting)

Participants: Swain Molster, Terry Lin, Daniel Alvarez, Feliks Albright. This is
the current authoritative shape; where it conflicts with anything above, this
wins. Don't merge to prod until a TDD is reviewed; work can start before.

### Three build phases

- **Phase 1 — Static / programmatic (no AI).** The Pre-launch + Launch tasks
  (the 22 global static tasks) plus the UI and the GOTV time-gating.
  Static now means **global — identical for every candidate, no personalization**
  (the `Type=Static` rows: all Pre-launch, all Launch, and the GOTV ops/close-out).
- **Phase 2 — Dynamic / CAP.** Active Campaign tasks + Community Events,
  **personalized per candidate via a single CAP experiment** (find up to 3
  events, then prioritize the top 12 tasks — events can be among them). Both
  events and tasks persist as `campaign_task` rows (`flowType = events` for
  events). The initial run is at **campaign-plan generation** (it needs the plan +
  story), **not** an office-submission pre-warm and not when the candidate first
  opens the tracker.
- **Phase 3 — Re-gen / CAP.** A weekly cron re-runs the experiment to
  re-prioritize the upcoming week, **replacing** the generated (non-static)
  `campaign_task` rows wholesale and folding in completion + any changes. No
  batching; default dispatch priority; ships disabled behind a flag.

### Display rules

- **Pre-launch + Launch:** show all their tasks (the static upfront set).
- **Active Campaign + GOTV:** show **3 and only 3 tasks per week**. Generate up
  to **7 MAX** (prioritized); the UI shows the **top 3**, with **progressive
  reveal** — complete #1 and #4 appears, complete #2 and #5 appears, and so on.
- **"Active Campaign" is NOT locked.** (An earlier draft said to lock it until
  Pre-launch/Launch were done — that was an error, corrected June 19.) Active is
  always visible and shows its capped weekly set from the start.
- **"Get out the vote"** tasks are displayed only when it is **≤30 days to the
  election**. Before that, show a **blue informational banner** explaining the
  GOTV effort and the time until it starts (GOTV is the one phase that hides its
  tasks before its window, since the work isn't relevant yet).
- All sections are **always visible** in the UI (GOTV bannered before its
  window). We do **not** show future weeks' tasks beyond the current capped set.
- Open question: combine "Active Campaign" + "Get out the vote"? For now keep
  them as separate sections; GOTV is gated by the banner + 30-day window.

### GOTV reframing (last 30 days)

In the final stretch (meeting said 30, also 30–45), the generator stops using the
"Active Campaign" framing and routes tasks into "Get out the vote" to change the
candidate's context; the AI is instructed to **prioritize GOTV** in that period.
The UI explains the timeline.

### Generation trigger + CAP inputs

- Pre-launch/Launch (static) exist immediately, programmatically, from the
  candidate's story.
- **Community events and dynamic tasks** come from **one CAP experiment** that
  first runs at **campaign-plan generation** (it needs the plan + story), then
  weekly. Events appear once the plan is generated (this replaces the earlier
  office-submission pre-warm) and are shown consistently in the plan, onboarding,
  and tracker. After the initial run, the weekly cron re-prioritizes and replaces
  the generated rows wholesale.
- CAP inputs: the ~30-task catalog (the menu) + plan, story, created tasks,
  completed tasks, `today`, `election_date`. The model finds up to 3 events and
  selects/ranks/personalizes the top 12 tasks; gates and dates stay deterministic.
- Swain's framing to weigh in the TDD: "maybe generate once, but prioritize
  weekly" — i.e., generate the candidate's set once and have the weekly job
  re-prioritize rather than fully regenerate.

### Weekly digest change

- The digest email shows the **top 3** uncompleted tasks (changed from 5), with
  outreach prioritized, and its prioritization must **match what the UI shows**.
- Notify Joe; no change is needed on their end.

### Schema / process

- **Schema change: add a `priority` field** (the priority tier) to the task data.
  (Update June 19: dropped — we are **not** adding a priority column to
  `campaign_task`. The static tier resolves from the catalog via `catalogId`, and
  weekly prioritization rides the existing `week`/`date` fields. See the TDD.)
- Next steps: high-level technical design (Fri/Mon), then TDD review before
  prod merge. Design must cover the weekly cron, data flow, onboarding, digest
  changes, CAP usage, and the inputs.

### What this changes in the code already built

Implemented in the shipped section (`buildCampaignStrategy.ts` +
`CampaignStrategyPhase.tsx`): the 3-per-week cap with progressive reveal for
Active + GOTV and the 30-day GOTV window with the blue banner. The Active lock
that was added earlier is being removed — Active is not locked (June 19
correction). This area (catalog, sequencer, UI gating) is being worked on
separately; coordinate before editing it.

Still open — **task completion is not persisted.** Every task renders with
`completed: false` hardcoded, so progressive reveal can never advance in the
running build. Direction (June 19): rather than invent a new scheme, **reuse the
existing `campaign_task` table** + `PUT/DELETE /campaigns/tasks/complete/:id`
completion flow + the existing task CTA/link UI. The static Pre-launch/Launch
tasks replace the current default-task generator by materializing catalog tasks
as `campaign_task` rows (CUID ids; the catalog string id rides along as a stable
key). Dynamic tasks persist the same way. Detailed in the TDD.

### Post-onboarding entry flow (moving off the success page)

We are moving away from the dedicated `/onboarding/success` page and routing the
candidate directly into the dashboard after onboarding.

- **For now:** after the pledge step, land the candidate on `/dashboard` (not
  `/onboarding/success`). A separate in-progress feature (the campaign-story page)
  will ask the candidate a set of questions, and **finishing that page is what
  triggers campaign-plan generation** — so the generation trigger is moving there,
  off the current office-submission pre-warm in `OnboardingFlow.tsx`.
- **`/onboarding/success` stays as-is for now** but is slated for removal once the
  new flow lands. Cleanup needed later: the success route/component, and the
  pledge-step branch that routes to it (`OnboardingFlow.tsx:958-970`). Its content
  already lives at `/dashboard/campaign-plan` via the shared `useCampaignPlanData`
  hook, so nothing unique is lost.
- **Generation-timing race (resolved).** `/dashboard/campaign-plan` has a
  server-side guard (`GET /v1/campaignStrategy/mine/exists`) that redirects to
  `/dashboard` when no strategy row exists. The campaign-story phase creates the
  `campaign_strategy` row before the candidate reaches the tracker, so the guard
  passes. Remaining cross-feature detail: the exact dispatch handoff (what the
  campaign-story feature calls to kick off generation) and rendering the
  generating/polling state on the destination page.

---

## Prototype

Source: https://snuggle-nav-kit.lovable.app/campaign-plan (public Lovable build,
no login). This is the design source of truth per the meeting notes. The left
nav chrome is still the Serve shell, but the page content is the Win campaign
plan for a sample candidate, "Terry Lin for Illinois State Senate, District 20,
Election Day Nov 3, 2026."

The important takeaway: the prototype already renders the plan as a phased,
dated, parameterized game plan. It is the closest thing we have to a picture of
what the plan-to-tracker data contract (ENG-10407) must emit. Everything below
is rendered prototype data, not live gp-api output. gp-api today terminates the
plan in a PDF / `aiContent` JSON blob; the prototype shows the target structure.

### Full plan overview

![Full campaign plan page](docs/assets/campaign-tracker-v3/01-campaign-plan-full.png)

Top to bottom the plan is: Path to Victory thermometer, the four-phase game plan
with dated tasks, then sections we are not focusing on now (budget, funding mix,
race-at-a-glance, ranked voter issues). The tasks are the focus.

### Path to Victory thermometer

![Path to Victory thermometer and game plan header](docs/assets/campaign-tracker-v3/02-path-to-victory-and-game-plan.png)

Maps to the gamified progress tracker (ENG-10410). "About 60,353 people are
expected to vote. You need 30,177 of them to win, and you are at 2,400 likely
votes so far ... About 27,777 votes to go." This is the voter-contact thermometer
toward the votes-needed-to-win number. The recording task that moves this bar is
the weekly "Record your voter contacts" task in the epic.

### Four-phase game plan with dated tasks

![Game plan four phases with dated tasks](docs/assets/campaign-tracker-v3/03-game-plan-phases-dated-tasks.png)

This is the phase sequencer (ENG-10408) made concrete, and it confirms the
four phases exactly: Pre-launch, Launch, Active campaign, Get out the vote. Each
phase carries a state (Done / Happening now / Coming up) and a "YOU ARE HERE"
marker; the current phase is expanded. Inside Active campaign, tasks are grouped
by objective (VOTER ID, PERSUASION). Each task row has a sequence number, a real
date (Sep 27), a titled action ("Work Logan Square Fall Fest"), a description, a
"Do this next" priority badge, and a deep link to the tool that does the work
("Open Calendar"). Logan Square Fall Fest and the District 20 candidate forum
are named civic events, the generated-per-item task type.

### Parameterized outreach tasks and a dated GOTV milestone

![Persuasion outreach tasks with parameters and GOTV phase](docs/assets/campaign-tracker-v3/04-persuasion-outreach-tasks.png)

This is the pills engine's Layer 2 parameterization (ENG-10409) and the plan's
dated outreach schedule. The persuasion text task is stamped "~76,661
cellphones" and the robocall task "~12,722 landlines", numbers computed from the
district electorate (L2). The Get out the vote phase shows a dated milestone:
"Next: Voter registration deadline on Oct 18." Dated milestones like this are
what anchor the timeline, the gap the one-pager calls out (filing, registration,
early-vote dates living in the PDF and never becoming tasks).

### Launch and Get out the vote phases

![Launch phase expanded with completed intro tasks](docs/assets/campaign-tracker-v3/07-launch-phase-tasks.png)

![Get out the vote phase with a dated milestone and early-vote task](docs/assets/campaign-tracker-v3/08-gotv-phase-tasks.png)

The "my game plan" section is the campaign tasks (the title copy changes later).
Expanding every phase shows the same task shape repeating, which makes the reuse
clear:

- Launch (Done): "Send your intro text" (Sep 8, ~76,661 cellphones) and
  "Schedule your intro robocall" (Sep 15, ~12,722 landlines). These are the
  existing default Introduction Text/Robocall tasks.
- Active campaign (Happening now): the VOTER ID tasks are the community events
  ("Work Logan Square Fall Fest", "Work Ward town hall", and in PERSUASION the
  "District 20 candidate forum"); PERSUASION also holds the persuasion text /
  robocall / press tasks.
- Get out the vote (Coming up): "Voter registration deadline" (Oct 18, a dated
  milestone with no tool link) and "Send your early vote text" (Oct 20). These
  are the existing Early Voting / Election Day reminder tasks plus a date
  milestone.

So the game plan is mostly the existing outreach task catalog, re-bucketed into
four phases, with community events slotted into the Active campaign phase. That
is the core of what V0 needs to assemble.

(The prototype's "What it costs" budget and "What your voters care about" ranked
issues sections are intentionally out of scope here — the current focus is the
tasks. The budget/fundraising thermometer and the issues list are deferred.)

### What the prototype tells us about the data contract

The prototype is effectively a spec for ENG-10407. To build the tracker without
a second pipeline, the plan needs to emit, as structured data rather than prose:

- Phases with state and ordering (Pre-launch, Launch, Active campaign, GOTV).
- Dated tasks, each with: phase, objective group, sequence, date, title,
  description, priority (the P1/P2 levels from the meeting notes), a tool deep
  link, and any parameter values (cellphone/landline counts, vote targets).
- Dated milestones (registration deadline, early-vote start, filing) as
  first-class timeline anchors.
- The named items that spawn generated-per-item tasks: civic events (Sec 7),
  press outlets (Sec 7), and the office's related-body meetings.

Most of these values already exist in plan generation; the contract is about
emitting them in a typed, machine-readable shape (in `@goodparty_org/contracts`)
instead of only rendering them.

---

## V0 build: leverage, gaps, and open questions (game plan + events)

Scope of this section: the "my game plan" task list (the four phases) and the
events that fill it, which is the near-term focus. The two ClickUp docs are the
source of truth for what the feature must deliver; this section maps that onto
what the code already has. Sources: the one-pager
(`2ky4jq2q-103793` / `2ky4jq2q-86673`) and the epic (ENG-10406).

### What we can leverage today

The game plan is mostly a re-bucketing of task and event data that already
exists. Verified against the code:

- Outreach task catalog (the bulk of the phases). The default task fixtures
  already define the 7-ish send schedule the plan renders:
  `defaultTasks.ts` (6 general) and `defaultTasksForPrimary.ts` (6 primary):
  intro text/robocall, persuasion text/robocall, early-voting text, election-day
  reminder. These are exactly the Launch, PERSUASION, and GOTV tasks in the
  prototype. Created on plan generation via
  `campaignTasks.service.ts:352` (`generateDefaultTasks`) into `campaign_task`.
- Recurring habits. `defaultRecurringTasks.ts` (10 tasks: social posts,
  fundraising ask, email updates, house party, fundraiser, volunteer events,
  letters to editor, door knocking, phone banking) with `recurrence` rules.
  These are the "recurring habits fill in after the dated items" layer.
- Milestone/awareness tasks. `defaultAwarenessTasks.ts` (10 milestone tasks at
  10/25/50/75/100% of fundraising and voter contact). These line up with the
  epic's 9 progress milestones that move onto the thermometer (ENG-10410) rather
  than staying task cards.
- Community events, already generated. `campaign_strategy.community_events`
  (JSON) holds up to 3 district-specific events, each with title, description,
  date (YYYY-MM-DD), address, and url. Generated by
  `communityEvents.service.ts:49` (Gemini search + structured extraction),
  endpoint `POST /campaignStrategy/mine/community-events`. These are the
  "customized community events" to reuse: they map to the prototype's VOTER ID
  event tasks (Logan Square Fall Fest, Ward town hall, District 20 forum).
- An existing event-to-task path. There is already a separate flow that turns
  events into `campaign_task` rows: `aiGeneration.service` →
  `CAMPAIGN_PLAN_COMPLETE` SQS → `campaignTasks.service.ts:967` (`addEventTasks`,
  builds "parade awareness tasks"). Note this is a different event source from
  `community_events` (Lambda result vs Gemini JSON).
- Task type taxonomy. `CampaignTaskType` already has `events`, `socialMedia`,
  `compliance`, `education`, `awareness`, `recurring`, plus the outreach types,
  which is enough to categorize most cards.
- Ranker + cron precedent. `weeklyTasksDigest` already does static-rows +
  SQL rank + cap + weekly cron (see the section below). It is the closest
  working template for the P1/P2 top-3-to-4 surfacing.
- Win-number math for the thermometer is already computed in plan generation
  (the prototype's 30,177-to-win / 60,353-expected numbers).

### Gaps (what is missing)

- No phase attribute. `campaignTask.prisma` has no phase field; tasks are ordered
  only by `week` + `date`. The four phases (Pre-launch, Launch, Active campaign,
  GOTV) must be added or derived deterministically from (type, week, date).
- No priority field. The meeting notes call for P1/P2 to surface the weekly top
  3 to 4. The schema has no priority/tier column.
- No objective sub-grouping. The prototype groups Active-campaign tasks under
  VOTER ID and PERSUASION. Nothing models that grouping today.
- Community events never reach the task list. `community_events` lives in JSON
  and is not rendered in the game plan or converted to tasks. This is the main
  wiring gap for the events focus.
- Two divergent event sources. `community_events` (Gemini, has address/url/date)
  vs the Lambda `addEventTasks` path. They are not reconciled; it is unclear
  which is canonical for the tracker.
- Event taxonomy missing. `community_events` has no `type` field (just
  title/description/date/address/url). The meeting notes want a structured event
  taxonomy (community event, farmers market, town hall, candidate forum, ...).
- Sparse setup and close-out tasks. The catalog is outreach-heavy. The Pre-launch
  setup tasks (EIN, bank account, PO box, treasurer, ...) and GOTV close-out
  tasks (thank volunteers, post-election message, final filing) the docs list as
  net-new are largely absent. The prototype's Pre-launch shows "Done" with no
  visible task children.
- Dated milestones not first-class. The prototype shows "Voter registration
  deadline" as a GOTV item. Registration/filing/early-vote dates exist upstream
  (BallotReady) but are not emitted as task/milestone rows today.
- No prerequisites. The epic wants prerequisite enforcement (no online donations
  before bank account, no text sends before 10DLC). Not modeled; 10DLC state
  does live in `tcrCompliance/`.

### Open product questions

Answers needed from product (Terry/Jack/PM) before or during build. The two
ClickUp docs are the source of truth; these are the gaps they leave open, plus
the scope change the current direction introduces. The task-catalog refactor
depends on these.

1. LLM personalization scope (highest priority — it's a scope change). The
   one-pager and epic explicitly defer Layer 3 (model-written copy) to v2, and
   our own meeting notes said "no AI personalization in V0." The current
   direction adds an LLM call to personalize dynamic-task copy in V0. Confirm
   this is intended, and confirm the guardrail: the model voices copy only and
   never invents a date, number, or compliance step.
2. Which dynamic tasks get the LLM? All 51 Dynamic (content-pill +
   generated-per-item), or keep content-pill tasks as deterministic token
   injection (per the docs) and reserve the LLM for a subset? What tone/voice
   guidelines, and what plan context feeds the prompt?
3. Pro-gating (ClickUp open Q — Terry + Jack): which Proposed tasks are Pro vs
   free? The xlsx marks the 4 text/robocall sends Pro required; confirm the rest.
4. Proposed-task CTAs: Proposed tasks have no real tool yet. In V0 do they render
   informational (no action), and which (if any) get a working CTA?
5. Election-type adaptation: how do tasks marked "adapts to general/primary"
   change for a primary vs general race, and which sends fire for a primary?
6. Jurisdiction dates: which of ballot-access start / filing deadline /
   registration deadline / early-vote start+end do we reliably get from
   BallotReady or the plan? When a date is missing, show the task undated or hide
   it?
7. Phase boundaries: what moves a candidate Pre-launch -> Launch -> Active ->
   GOTV — pure dates, or a launch action/milestone (e.g. "Hold your kickoff
   event")?
8. Recurring tasks: render one card per occurrence, or a single card with a
   cadence label sitting below the weekly top-3?
9. Weekly top-3 ranker: confirm the scoring weights (tier vs deadline urgency vs
   goal-gap) and the definition of the "variety rule."
10. Keystone data contract (ClickUp open Q — Lead Dev): the minimum the plan must
    emit so the tracker builds week buckets without a second pipeline.

Engineering / data contract:

- Canonical event source: do we surface `community_events` (Gemini JSON) directly
  in the tracker, or convert events into `campaign_task` rows? And what happens to
  the Lambda `addEventTasks` path, keep, replace, or merge?
- Read model for V0: does the tracker read existing `campaign_task` rows plus
  `community_events` JSON and merge/bucket/prioritize at read time (no second
  pipeline, matching the epic's keystone question), or materialize everything
  into `campaign_task`?
- Schema changes: add `phase` and `priority` columns to `campaign_task`, or keep
  them out of the table and compute in the contract/read layer? (New migration if
  columns; see `prisma/CLAUDE.md`.)
- Event-to-task mapping: what fields does a community event become on a task
  (title -> "Work {event}", date -> task date, address/url -> cta/link, a fixed
  description template)?
- Feature flag: confirm deleting the existing "campaign manager" flag and what
  gates the new tracker in its place.

---

## Component mapping: Lovable design to our styleguide

We reuse `@styleguide` (`packages/gp-webapp/styleguide/`, shadcn/Radix + Tailwind
v4 + CVA) wherever a counterpart exists, and write a custom component only where
one does not. The Lovable build is itself shadcn-based, so the parallels are
close to one-to-one.

| Lovable element | Our styleguide counterpart | Notes |
| --- | --- | --- |
| Phase section (expand/collapse, header + status badge + chevron) | `Accordion` / `AccordionItem` / `AccordionTrigger` / `AccordionContent` | Use `type="multiple"` so several phases open at once; current phase open by default. |
| Status badge (Done / Happening now / Coming up) | `Badge` | Map: Done -> `secondary`, Happening now -> `default`, Coming up -> `outline`. |
| Priority badge ("Do this next") | `Badge` (`default`) | Single highlighted next task. |
| Card container | `Card` / `CardHeader` / `CardContent` | Phase and task grouping. |
| Path to Victory thermometer | `Progress` + small custom marker overlay | `Progress` covers the bar; the labeled "to win" marker has no counterpart, so a thin custom overlay. |
| Date chip / parameter chip ("~76,661 cellphones") | `Badge` (`soft` / `outline`) | Reuse Badge as a chip. |
| Action link ("Open Calendar", "Open the tool") | `Button` `variant="link"` `asChild` + `ExternalLinkIcon` | Wrap an anchor with `asChild`. |
| Eyebrow / overline ("VOTER ID", "YOUR PATH TO VICTORY") | none | Inline `text-xs uppercase tracking-widest text-muted-foreground`, the existing PlanSections convention. |
| Icons | `@styleguide` curated icons (`icons.tsx`) | Never import `lucide-react` directly. |
| Funding-mix pie | `DonutChart` | Not part of the task focus. |

The section is named "Campaign strategy" (not "game plan"). Custom components to
add (no styleguide counterpart), composed from the above:

- `CampaignStrategyTaskRow` — one task line (number, date chip, title,
  description, parameter chip, action link). The existing `CampaignPlanTaskItem`
  is a checkbox list item with a different shape, so this is a new row.
- `CampaignStrategyPhase` — thin wrapper over `Accordion` for a phase (header
  with title + status badge, body with objective groups and rows).
- `CampaignStrategySection` — the section that stacks the four phases and is
  dropped into the campaign plan page.

These live under
`packages/gp-webapp/app/dashboard/campaign-plan/components/campaignStrategy/`.
Phase and priority are not in the data yet (see gaps above), so a provisional
ordering/status helper sits next to the components and is clearly marked as
first-pass until the data contract lands.

Implementation status (landed): the section is built and wired into the campaign
plan page. Files:

- `campaignStrategy/campaignStrategy.types.ts` — presentation model (phase,
  objective, task).
- `campaignStrategy/buildCampaignStrategy.ts` — PROVISIONAL builder. Assembles
  the four phases from the campaign's existing metrics (cellphone/landline
  counts, election date) plus the real `community_events`. Dates static tasks by
  weeks-before-election the same way the dashboard task list does. Derives phase
  status and the single "Do this next" task. To be replaced by ENG-10407.
- `campaignStrategy/CampaignStrategyTaskRow.tsx` — task row: index/check, date,
  title, "Do this next" `Badge`, description, parameter `Badge`, action `Button`
  link.
- `campaignStrategy/CampaignStrategyPhase.tsx` — one phase as an `AccordionItem`
  (title + status `Badge`, objective groups, rows).
- `campaignStrategy/CampaignStrategySection.tsx` — fetches `useCampaign` +
  `useCommunityEvents`, builds the plan, renders the phases in a multi-open
  `Accordion`, opens the active phase by default.
- `CampaignPlanView.tsx` — renders `<CampaignStrategySection />` above the
  existing `PlanView` (dashboard campaign plan only; the shared onboarding plan
  is untouched).

Reuse outcome: every primitive maps to a styleguide component (`Accordion`,
`Badge`, `Card`, `Button`, curated icons). The only net-new code is the three
app-level composition components and the provisional data builder. Verified with
`tsc --noEmit` (clean) and `eslint` (no new errors). Community events render as
real per-district event tasks; the outreach/setup tasks are the existing default
catalog, dated from the real election date, pending the data contract.

---

## Task catalog refactor plan (from campaign-tasks-master.xlsx)

This replaces the provisional 8-task `buildCampaignStrategy` with the real task
catalog. Source of truth: `campaign-tasks-master.xlsx` (in Downloads; not
committed). It has four sheets:

- **Tasks (58):** Phase, Type (Static/Dynamic), Category, Title, Description,
  Channel, Cadence, Timing, Day, Election type, Pro required, Status
  (Live/Proposed), Personalization (Content pills / Generated per item /
  Static), Pills (tokens), Plan source, Priority tier (P1–P4), Unlocks after.
- **Overview:** Pre-launch 14 / Launch 8 / Active 17 / GOTV 19. 51 Dynamic, 7
  Static. 48 content-pill / 3 generated-per-item / 7 static. Tiers P1×24, P2×20,
  P3×9, P4×5. Weekly top-3 = filter (phase active + prerequisite met + due now)
  -> score (tier + deadline urgency + goal-gap) -> top 3 with a variety rule.
- **Gamification:** 9 progress milestones pulled OUT of the task list; they are
  thermometer markers (voter-contact + fundraising), not cards.
- **Pill library (25 tokens):** each mapped to a plan source + availability
  (Live / Partial / Future). Most are Live and map to data we already fetch.

### Decisions (locked)

1. **Catalog is hand-written TypeScript**, not generated from the xlsx. The
   sheet is the reference; an engineer transcribes it into a typed array.
2. **Proposed tasks are shown** alongside Live (58 total, not just the 22 Live).
   Proposed tasks without a real tool render as informational cards.
3. **Dynamic tasks are personalized to the candidate via an LLM call.** The
   catalog holds template copy; dynamic tasks (51 of 58) get their title and
   description rewritten in the candidate's context. Static tasks (7) render
   as-is. This brings Layer-3 voicing forward for dynamic tasks (a change from
   the earlier "defer Layer 3" stance), per the latest direction.

### Catalog: hand-written TS

`campaignStrategy/taskCatalog.ts` exports `CampaignTaskDefinition[]` (all 58):

```
phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
type: 'static' | 'dynamic'
category, title, description (template copy)
channel: 'text'|'robocall'|'doorKnocking'|'phoneBanking'|'directMail'
       | 'event'|'awareness'|'general'        // -> icon + (where live) tool
cadence, timing (structured union, below), dayOfWeek?
electionType: 'both' | 'adapts'
proRequired: boolean
status: 'live' | 'proposed'
personalization: 'content-pill' | 'generated-per-item' | 'static'
pills: string[]                                // tokens this task can bind
priorityTier: 'P1' | 'P2' | 'P3' | 'P4'
unlocksAfter?: TaskId                           // prerequisite
generatorSource?: 'communityEvents' | 'pressOutlets' | 'officeMeetings'
```

The render-time `CampaignStrategyTask` keeps the presentational shape and gains
`priorityTier`, `proRequired`, `status`, `locked` (prereq unmet).

### Timing model (replaces weeksBeforeElection)

A discriminated union the sequencer resolves to a date or "undated". This fixes
the current bug where setup tasks were dated election-relative:

- `electionRelative {weeksBeforeElection}` (ED-N), `electionDay`,
  `afterElection {weeks}` (ED+N)
- `asap` / `onboardingWeek` / `preLaunch` / `launch` — anchored near campaign
  start, not the election
- `jurisdiction` — resolve from real plan-timeline pills we have
  (`filingDeadline`, `regDeadline`, `earlyVotingStart`/`End`, `ballotAccessStart`);
  undated if absent
- `recurring {interval: weekly|monthly|evenWeeks|oddWeeks, dayOfWeek}`
- `perItem` — date comes from the generated item (event/outlet/meeting)

### Dynamic tasks + community events via CAP (tentative — for review)

> **Superseded (June 22) — see the TDD.** This section described **two**
> experiments, a `dynamic_tasks` JSON blob, and `catalog_id` / `priority_tier`.
> The current design is **one** experiment writing `campaign_task` rows (events
> included as `flowType = events`), no JSON blob, no `catalog_id` / `priority`
> columns. Kept below for history.

Static tasks render their template copy. Dynamic tasks (and community events) are
personalized and curated by **CAP** — the Campaign AI Platform / PMF experiment
engine in `packages/runbooks/experiments/` that already generates the plan's
opposition/opportunities sections. This is a tentative approach we can iterate on.

How CAP works (grounded in the existing strategic-landscape integration):
- Author an experiment under `packages/runbooks/experiments/<id>/`: a
  `manifest.json` (id, version, model, max_turns, timeout, `input_schema`,
  `output_schema`) + an `instruction.md` (the agent's system prompt + rules).
  Publish with `scripts/python/publish_experiments.py` (uploads to S3, atomic
  `index.json`); types generate into `AgentJobContracts`.
- Dispatch from gp-api: `ExperimentRunsService.dispatchRun({ type,
  organizationSlug, clerkUserId, params })` creates an `ExperimentRun` (runId,
  status RUNNING) and enqueues to the agent-dispatch FIFO SQS. A cloud agent
  (Claude per the manifest, with web search) runs `instruction.md` and writes a
  JSON artifact to S3.
- Result: SQS `AGENT_EXPERIMENT_RESULT { runId, status, artifactBucket/Key,
  costUsd }` -> `queueConsumer.handleAgentExperimentResult` -> loads the artifact
  -> a feature callback (like `campaignStrategy.onExperimentRunCompleted`) parses
  and persists it in a race-guarded transaction. Partial results can resume.
- Link the `runId` on the owning row; match the result by runId/type. Runs are
  observable via `admin/agentRuns`; a sweeper fails runs stuck >45 min.

New experiment (working name `campaign_tracker_tasks`):
- Input params: identity + `race_id` (as strategic-landscape), the campaign
  context (issues, opponents, win number, contact goal, budget, dates),
  `election_date`, `today`; the **dynamic task catalog** (id, phase, channel,
  tier, template copy, pills — the menu to personalize/select from); `prior_tasks`
  (previously-generated dynamic tasks + completion status); `prior_events`
  (previously-generated community events); and `mode: initial | weekly`.
- Output artifact: `dynamic_tasks` (personalized — full set on initial, the
  curated upcoming-week set on weekly, each `{ catalog_id, title, description,
  priority_tier, phase, channel }`) and `community_events` (curated
  `{ title, description, date, address, url }` across `[today, electionDate]`,
  multiday-deduped).
- `instruction.md` encodes the skills: personalize copy in the candidate's voice;
  use the full generated set to **avoid repeating same-type tasks**; on weekly,
  **push incomplete-but-important tasks forward** (e.g. unfinished door-knocking
  becomes a focus next week); reframe to GOTV in the last 30 days; never invent a
  date, number, or compliance step (Layer-3 guardrail).

Flows:
- **Initial generation — generate everything.** Trigger when the candidate
  finishes Pre-launch/Launch (first opens the tracker). Dispatch
  `campaign_tracker_tasks` `mode=initial`, empty `prior_*`. Persist the full
  personalized `dynamic_tasks` set + `community_events` (whole campaign) on
  `campaign_strategy`; store the runId.
- **Weekly cron — re-evaluate the upcoming week.** Mirror `weeklyTasksDigest`
  (`@Cron` weekly + SQS-FIFO dedup). Fan out one dispatch per eligible campaign
  (active, setup done, future election). `mode=weekly` with `prior_tasks`
  (current week + completion status) and `prior_events`. The agent re-evaluates
  the **upcoming week's** dynamic tasks — re-prioritizing and curating against
  what was completed and the full prior set (so it doesn't repeat similar tasks)
  — and refreshes community events (curate prior + search new for the window,
  multiday-dedup, lookahead to end of campaign). Persist the new upcoming-week
  selection + curated events.

Deterministic vs CAP split (keeps the Layer-3 guardrail):
- **CAP (the agent):** personalize copy, select/prioritize the week's dynamic
  tasks, avoid repeats, discover/curate community events.
- **Deterministic (gp-api sequencer + persist):** the hard rules — lock Active
  until setup done, the 30-day GOTV window, the 3-visible cap + progressive
  reveal, date placement from the timing model, event merge/dedup. The model
  never sets those gates or dates.

Persistence: new `campaign_strategy` JSON for `dynamic_tasks` (the personalized
pool + per-week selection + completion) plus the existing `community_events`; add
a `priority` field (the meeting's schema change); a `<feature>RunId` +
refreshed-at for the weekly guard; race-guarded like the existing persisters.

Reuse vs new:
- Reuse: the entire CAP dispatch/result/queue/monitoring infra, the `@Cron` +
  SQS-dedup skeleton, the eligible-campaigns query, and (for events) the existing
  search pipeline if we keep it separate.
- New: the `campaign_tracker_tasks` experiment (manifest + instruction), a weekly
  cron service + 1–2 QueueTypes (trigger + per-campaign), a result/persist
  callback for this experiment, the `campaign_strategy` fields + `priority`, and
  the event merge/curation.

Open questions:
- One experiment for tasks+events (agent web-searches events too, shared context
  to avoid repeats), or keep community events on the existing Gemini pipeline and
  drive both from the same weekly cron? Recommend one experiment for shared
  context, but the events pipeline already exists.
- Catalog location so the agent input can include it — recommend
  `@goodparty_org/contracts` (shared by webapp + gp-api), not duplicated.
- Cost: one CAP agent run per active campaign per week; throttle via per-campaign
  SQS; cost is already tracked per run (`costUsd`).

### Community events coverage (weekly cron)

> **Superseded (June 22) — see the TDD.** Community events are no longer a
> separate cron/pipeline: the single tracker experiment finds them and stores them
> as `campaign_task` event rows. The SQS/Gemini mechanics below are historical.

This is the events-specific detail for the same weekly run described in "Dynamic
tasks + community events via CAP" above — whether events are curated inside that
CAP experiment or kept on the existing Gemini pipeline, these rules apply.

Decision: catalog tasks are generated upfront (no cron), but community events DO
get a weekly cron. We want **real, customized, district-specific** events across
the whole campaign — not generic recurring/annual events. Since the generator is
a grounded Google-Search pass, it only finds **already-announced, near-term**
events; the only way to cover the full timeline with real events is to keep
searching as the campaign progresses and **accumulate** them.

Current generation (for reference):
- Window is `[today, electionDate]` where `today = format(new Date(), 'yyyy-MM-dd')`
  at generation time and `electionDate` is the campaign's election date
  (`buildEventsContext`, `campaignStrategy.service.ts:498`).
- Returns up to 3 events (capped in three places: contracts
  `CommunityEventsResultSchema.max(3)`, `MAX_EVENTS = 3`, and the filter prompt).
- The persister REPLACES the whole array (`persist` → `updateMany`).
- So the onboarding 3 are real near-term events. Treat them as the seed; the
  cron curates and accumulates from there. This requires merge/curation instead
  of blind replace.

Rules (June 17):
- **Lookahead window: current week → end of the campaign**, not just one week
  ahead. Each run searches the full remaining `[today, electionDate]` so it can
  pick up newly-announced events anywhere in the future, not only next week.
- **Feed the previously-generated events back into each run for curation** — so
  the model can update, re-date, or drop changed/cancelled events, not just
  append new ones.
- **Multiday events must appear only once** (collapse a multiday run into a
  single entry; dedup on the event identity, not per-day).

What we reuse from the existing `weeklyTasksDigest` cron:
- The `@Cron('0 23 * * 0', America/Chicago)` weekly trigger + the SQS-FIFO
  dedup trick (each ECS pod fires; a deterministic `deduplicationId` collapses
  to one run).
- The queue producer/consumer infra (`QueueType`, `sendMessage`, consumer
  switch) and the eligible-campaigns query shape.
- The generation core unchanged: `runEventsGenerationCore` -> `buildEventsContext`
  -> `communityEvents.generate` (search -> structured -> windowAndClamp).
- NOT the digest's single-query process-all handler: events cost a Gemini call
  per campaign, so fan out one message per campaign and throttle.

Cron implementation plan:
1. Trigger — new `CommunityEventsRefreshService` (mirrors weeklyTasksDigest):
   weekly `@Cron`, enqueues one `WEEKLY_COMMUNITY_EVENTS_REFRESH` with
   `deduplicationId = communityEventsRefresh-${weekStartISO}`.
2. Fan-out handler — query eligible campaigns (active, has a campaign_strategy
   row, future election) and enqueue a per-campaign `COMMUNITY_EVENTS_REFRESH`
   message each (throttled; retry/DLQ per campaign).
3. Per-campaign handler — build context for the full remaining window
   `[today, electionDate]`, pass the existing `community_events` in as prior
   context for curation, run the generation, then persist the curated set:
   collapse multiday events to one entry, dedup (by `url`, else `title`+`date`),
   drop past and out-of-window, sort by date. (This replaces the current
   replace-only `persist`.)
4. Cap — curation/accumulation breaks `max(3)`; raise/uncap the stored list and
   keep the plan PDF Section 7 slicing its top 3. Cross-service: contracts +
   gp-api + webapp in one PR.
5. Guard — a `communityEventsRefreshedAt` stamp (or reuse `generation_started_at`)
   to skip campaigns already refreshed this week and make reruns idempotent.

Net: new = the events cron service, 1–2 QueueTypes + consumer cases, the curation
pass (prior events fed back in + multiday-dedup) replacing the replace-only
persist, and the raised/decoupled cap + refreshed-at guard. Reused = cron+dedup
skeleton, queue infra, eligibility query, and the whole generation pipeline.

### Sequencer (build) logic

`buildCampaignStrategy` becomes a sequencer over the catalog:
- Filter by `electionType`; resolve `unlocksAfter` -> mark `locked`; keep both
  Live and Proposed.
- Resolve `timing` -> date (or undated). Phase status derives from where "now"
  sits across dated tasks (lights up "Happening now"/"Done").
- Rank with `priorityTier` + deadline urgency (the sheet's top-3 rule); the
  top item is "Do this next" (replaces the date-only `isNext`).
- Generated-per-item: wire the 3 generators — community events (have), press
  outlets (have via local-news), office meetings (defer).
- Merge LLM-personalized copy for dynamic tasks; bind Live pills deterministically.

### Component impacts

- Extend `TASK_ICONS` for every channel (door-knocking, direct-mail, event,
  awareness, general, fundraising).
- `proRequired` tasks get a Pro affordance; `locked` tasks render disabled with
  an "Unlocks after X" hint; `proposed` tasks render informational (no live CTA),
  `live` tasks deep-link to the real tool.

### Deferred

- The 9 gamification milestones -> thermometers (separate from cards; matches the
  current "no thermometer yet" call).
- Future pills (`candidateSuperpower`, `threeMessages`, `targetDoors`,
  `precinct`) and the full goal-gap term of the top-3 ranker.

### Implementation order

1. Catalog (`taskCatalog.ts`) + expanded types + timing union — no UI change.
2. Sequencer replacing the 8-task builder (timing, phase status, prereqs, tier
   ranking). Static tasks render template copy.
3. Generated-per-item wiring (events live; outlets next; meetings deferred).
4. LLM personalization service (gp-api) + `usePersonalizedTasks` + merge.
5. Component polish (icons, Pro/locked/proposed states).

---

## weeklyTasksDigest: how it works today

A cron-to-queue-to-event pipeline. This is the closest existing precedent for
the new ranker and dated-window sequencing, and the current outbound
notification rail.

### Stage A — cron trigger

File: `packages/gp-api/src/campaigns/tasks/services/weeklyTasksDigest.service.ts`

- `@Cron('0 23 * * 0', timeZone: 'America/Chicago')` fires every Sunday 11 PM
  Central (`weeklyTasksDigest.service.ts:37`).
- Computes a Monday-to-Sunday window as UTC midnight boundaries via
  `nextMondayUtcMidnight` (`:14`), because task dates are stored as naive
  midnight-UTC calendar dates. DST-safe alignment is the subtle part.
- Every ECS instance runs its own cron, so each enqueues. A deterministic
  `deduplicationId` of `weeklyTasksDigest-${windowStart}` (`:64`) lets SQS FIFO
  collapse them to one message per week.
- Output: a single `QueueType.WEEKLY_TASKS_DIGEST` message carrying
  `{ windowStart, windowEnd }`.

### Stage B — queue handler

File: `packages/gp-api/src/campaigns/tasks/services/weeklyTasksDigestHandler.service.ts`

- `handleWeeklyTasksDigest(data)` (`:170`) runs one raw SQL query (`:183-235`)
  with two CTEs:
  - `eligible`: campaigns with a future `details->>'electionDate'` and at least
    `MIN_TASKS` (3) incomplete tasks in the window, with completed/incomplete
    counts denormalized onto each row.
  - `ranked_tasks`: `ROW_NUMBER()` per campaign ordering outreach types first
    (`text`, `robocall`, `doorKnocking`, `phoneBanking` from
    `OUTREACH_FLOW_TYPES`, `:9`), then by date ascending, capped at `MAX_TASKS`
    (5).
- Rows grouped in JS by campaign (`groupByCampaign`, `:138`). For each campaign
  it fires one Segment track event `EVENTS.CampaignPlan.WeeklyTasksDigest`
  (`:256`), keyed to `userId`.
- `buildTaskProperties` (`:100`) always emits all 5 task slots, blanking unused
  ones, so HubSpot clears stale data from the prior week. Each slot carries
  `task_name_N`, `task_description_N`, `task_type_N`, `task_due_date_N`,
  `task_week_number_N`, plus `plan_tasks_completed` / `plan_total_tasks`.
- Per-campaign failures are caught and logged; the run continues.

### Terminal hop is external

The Segment event name `'Campaign Plan - Weekly Tasks Digest'` is consumed by
HubSpot workflows to send the email. The name is marked DO NOT MODIFY in
`segment.types.ts`. gp-api does not send email; it emits an analytics event and
HubSpot does the rest.

Data flow in one line:
`@Cron -> SQS FIFO (dedup) -> handler reads campaign_task + campaign.details -> Segment track event -> HubSpot email`.

Manual tester: `packages/gp-api/scripts/test-weekly-tasks-digest-event.ts`
(single campaign, `--dry-run`).

### Supporting files

| Path | Purpose |
| --- | --- |
| `src/queue/queue.types.ts` | `QueueType.WEEKLY_TASKS_DIGEST`, `WeeklyTasksDigestMessageSchema`, `MessageGroup.weeklyTasksDigest` |
| `src/queue/consumer/queueConsumer.service.ts` | Routes the SQS message to the handler |
| `src/vendors/segment/segment.types.ts` | Event name constant (DO NOT MODIFY) |
| `prisma/schema/campaignTask.prisma` | `CampaignTask` model (`flowType`, `date`, `completed`, `week`, indexes) |
| `prisma/schema/campaign.prisma` | `Campaign.details` JSON holds `electionDate` |
| `src/campaigns/campaigns.module.ts` | Wires both services (`@Global`) |
| `*.test.ts`, `*.integration.test.ts` | Window math, eligibility, ranking, payload tests |

---

## Relationship to runbooks

Directly, there is none: the digest service never imports or invokes anything
in `packages/runbooks`. They are separate subsystems. Stating that plainly
matters because it is the crux of the tracker gap.

What `runbooks` is: a portable, agent-first operational library. The part that
matters here is `experiments/` — PMF experiment definitions, each a
`manifest.json` (input/output schema, scope) plus `instruction.md` (the agent's
procedure). These publish to S3 (`scripts/python/publish_experiments.py`) and
are dispatched by gp-api's `agentExperiments` module over SQS to Fargate. The
agent writes a JSON artifact to S3 and a result message returns via
`QueueType.AGENT_EXPERIMENT_RESULT`.

Relevant experiments: `opposition_research` (named opponents),
`district_issue_pulse` (voter issues), `meeting_briefing` / `meeting_schedule`
(civic events), `opportunities_and_challenges`.

How the two halves map onto the tracker:

- Runbooks/experiments produce the plan's content — named opponents, district
  issues, civic events. This is the source for the tracker's Layer 3 voicing
  and its generated-per-item tasks (3 in the xlsx: events, press outlets,
  office meetings).
- `campaign_task` rows + the digest are the existing rails that turn tasks into
  something the candidate receives.

The missing wire the tracker calls for is between them: experiment artifacts
(plus BallotReady/L2 deterministic lookups for Layers 1 and 2) need to be bound
into `campaign_task` rows. Today tasks are static templates and recurrence
rules (`defaultTasks.ts` etc.), not derived from experiment output, which is
why 51 of the 58 tasks (the Dynamic ones; the 7 Static ones don't) should pull
plan data and almost none do today.

---

## The six epic subtasks vs. existing code

### ENG-10407 — Plan-to-tracker data contract (keystone, gates everything)

Net-new and the real crux. The plan currently terminates in a PDF / `aiContent`
JSON blob; the ask is structured, machine-readable dated items + task seeds.
Relevant existing assets:

- Plan content already exists, produced by the `agentExperiments` / runbooks
  `experiments/` system.
- `campaignPlanVersions.service.ts` holds append-only plan JSON snapshots.
  Worth checking whether the contract is a new structured field on the plan
  version rather than a parallel store.
- The contract belongs in `@goodparty_org/contracts` since it crosses the
  plan-generation/tracker boundary.

### ENG-10408 — Phase sequencer

Net-new logic; the digest's window math is a working reference.
`nextMondayUtcMidnight` (`weeklyTasksDigest.service.ts:14`) is exactly the
"place dated items on real dates" primitive. New: four-phase bucketing and
prerequisite enforcement (no online donations before bank account, no text
sends before 10DLC). The 10DLC prerequisite ties into the existing
`tcrCompliance/` module, so prerequisite state is partly modeled already.

### ENG-10409 — Pills engine (3 layers)

Layers 1 and 2 (selection + parameterization) are deterministic lookups against
BallotReady and L2, both already integrated (L2 in `src/voters/`). The
generated-per-item tasks (3 in the xlsx: civic events, press outlets, office
meetings — not opponents) map onto experiment / plan artifacts, so this is where
that content finally becomes tasks. That binding does not exist today.

Direction update (see the refactor plan and open questions): the ClickUp docs
defer Layer 3 voicing (model-written copy) to v2, but the latest call brings an
LLM pass into V0 to personalize the copy of Dynamic tasks. So V0 is no longer
"deterministic only." The task catalog stays hand-authored and closed; the LLM
voices Dynamic-task copy under the guardrail that it never writes dates,
numbers, or compliance steps. So ENG-10409 in V0 is now two things: deterministic
Layer 2 (bind real numbers/dates into all tasks) plus an LLM Layer-3 pass that
rewrites the copy of Dynamic tasks. Static tasks render as authored. The model
voices copy only; it never invents the task list, dates, or numbers.

### ENG-10410 — Gamified progress tracker + contact recording

Net-new. Two thermometers (voter-contact toward win number, fundraising toward
budget) plus a weekly "Record your voter contacts" task. The
win-number/contact-goal math already exists in plan generation; the
contact-recording write path and milestone markers are new. Fundraising
thermometer is gated on a donation processor and may ship later.

### ENG-10411 — Weekly prioritization ranker

The natural evolution of the digest's SQL ranking. The handler already does
filter-plus-rank (`weeklyTasksDigestHandler.service.ts:199-234`: eligibility
filter, then `ROW_NUMBER()` ordering outreach types first, then by date, top
N). The epic wants a richer score (priority tier + deadline urgency + goal gap)
and a top-3 with a variety rule, but the shape is the same and the digest is a
proven template.

### ENG-10412 — Tracker UI + analytics

Frontend in gp-webapp, plus `Win - Tracker Viewed` / `Win - Task Completed` /
`Win - Phase Advanced` events. The epic says Amplitude; use the
`instrument-analytics-event` skill. The existing `AnalyticsService.track` path
the digest uses already reaches Amplitude/Segment.

---

## Where weeklyTasksDigest fits in the new world

It is the closest existing precedent for two pillars (the ranker and dated-window
sequencing) and the current outbound notification rail. Two open questions for
the team:

1. Does the email digest survive as the weekly nudge alongside the in-product
   tracker, or does the tracker's return loop replace it? If it survives, its
   SQL ranker and the new ranker (ENG-10411) should share one ranking
   definition rather than drift apart.
2. The digest reads `campaign_task` rows that are static templates today. Once
   the pills engine generates per-item tasks into `campaign_task`, the digest
   automatically starts emitting personalized tasks for free, since it just
   reads whatever rows exist. A useful incidental win, and a reason to land the
   data contract and pills engine before touching the digest.

## The honest gap

Nothing in the current code wires plan content into tasks. The plan-generation
half and the delivery half (campaign_task + digest + dashboard) both exist and
both work, but the plan terminates in a PDF / `aiContent` blob instead of
structured data. The keystone (ENG-10407) is that missing wire, and everything
else is gated on it, exactly as the epic states.

Two clarifications from the latest direction:

- V0 does not need AI task generation. It is a closed static task list with
  P1/P2 priority filtering, surfacing 3 to 4 tasks a week. So the real V0 work is
  the data contract plus a static phase/priority mapping, not model-driven
  generation. The experiment-to-task binding is a v2+ concern.
- The prototype at `/campaign-plan` already renders the target structure (phases,
  dated tasks, parameters, milestones, win-number math). It is the best available
  spec for what the contract must emit; see the Prototype section.
