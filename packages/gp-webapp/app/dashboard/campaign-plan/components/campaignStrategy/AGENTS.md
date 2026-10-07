# campaignStrategy/ (Campaign Tracker rendering)

Renders the Campaign Plan page's task rail (Campaign Tracker v3, ENG-10406):
three phases (launch / active / gotv) that are windows on the campaign's
timeline (contracts' `CampaignTimeline.ts`); a task sits in the phase its date
falls in. The cards are dated, prioritized tasks the candidate checks off. Feature overview + backend:
`docs/features/campaign-tracker-v3.md` and
`packages/gp-api/src/campaigns/campaignTracker/CLAUDE.md`.

## Key files

| File                          | Role                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useTrackerTasks.ts`          | Fetches `/campaigns/tracker-tasks`; exposes `isGeneratingDynamic`; fast-polls (20s) while the tracker is _settling_ (`isTrackerSettling`: no rows yet **or** static-only with dynamic still generating), slow background poll after, with a fast-poll budget cap; refetches on mount + window focus (and polls in the background) so navigating to the tab surfaces freshly materialized rows without a manual refresh. Also exports `useGenerateTrackerTasks` (the manual override — see below). |
| `buildTrackerStrategy.ts`     | Builds the render shape from persisted rows (the only path).                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `CampaignStrategySection.tsx` | The section: loading / error / setting-up / generating states, then the accordion. Renders only from persisted rows.                                                                                                                                                                                                                                                                                                                                                                              |
| `CampaignStrategyTaskRow.tsx` | One task card (date chip, channel icon, completion toggle).                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `CampaignStrategyPhase.tsx`   | A phase accordion item; the Active phase renders the `WeekNavigator` (one Mon-Sun week, back/forward one).                                                                                                                                                                                                                                                                                                                                                                                        |
| `campaignStrategy.types.ts`   | Render-shape types (`CampaignStrategyPhase`, `…Week`, `…Task`).                                                                                                                                                                                                                                                                                                                                                                                                                                   |

## Patterns / non-obvious logic

- **Render only the latest generation.** The backend appends each weekly run as
  a new `week`; `buildTrackerStrategy` filters dynamic rows to `max(week)` (plus
  the non-generational static rows). The Active week navigator (`buildActiveWeeks`)
  shows, per week, that week's dynamic-latest-gen tasks plus the deterministic
  `isDefaultTask` outreach dated in it. The gp-api weekly digest mirrors that
  active-week set (dynamic + text/robocall outreach, not the setup checklist), so
  keep the two in sync or the page and the email disagree.
- **A row's link label comes from its own `cta`, falling back to "Open".**
  Only the story task sets `cta` today ("Add your story"); the manager's task
  list prefers the same column.
- **Phase status has two axes.** `done` = every task in the phase completed;
  "happening now" (active) is date-driven (the first non-empty phase still in
  play). Empty intermediate phases are skipped so they can't strand a later
  populated phase as `upcoming`.
- **Launch renders all its tasks; Active is a week navigator.** No
  progressive-reveal cap (the weekly digest is what caps at 3). The Active phase
  is built by `buildActiveWeeks`: it buckets every active task (all generations,
  not just `max(week)`) into Monday-Sunday weeks, flags the week containing
  today, and `CampaignStrategyPhase`'s `WeekNavigator` shows one week at a time,
  bounded to the current week ±1 (older generations stay out of reach). GOTV is
  the one gated phase: hidden behind a window message until the election is
  within 30 days. Both the navigator window and the GOTV gate are deterministic
  here, not in the agent.
- **The section renders only from persisted rows.** `CampaignPlanView` renders
  it for every campaign; there is no client-catalog fallback and no story gate
  upstream. When the fetch settles with no rows the section shows a "setting up
  your tracker" state (bootstrap in flight).
- **Head start.** Once this week has no open task, the next-step card offers
  next week's: `buildTrackerStrategy`'s `headStartWeek` marks next week's
  first open task `isNext`, and the week navigator opens on it. The choice
  lives in the browser (`useHeadStartWeek`, shared by the card and the list)
  and only counts for next week, so it expires when the calendar gets there.
- **Skipping is saved on the server.** The next task's Skip (on the card and
  its row), every other open row's menu, and the API (`useSetTrackerTaskAside`, optimistic like
  completion) offer "Show in 3 days", which moves the task's date three days
  out so the plan sorts it behind what's due sooner, and "Not for me", which
  sets it aside until "Bring it back" in its menu. Tasks dated by fact (the
  Election admin dates, Election Day) can't be put off, and ballot access
  can't be Not for me; the rules live in contracts' `TrackerTaskSkip.ts`,
  shared with gp-api. `buildTrackerStrategy` never makes a not-for-me task
  the next one (`canBeNext`).
- **A row's date line is its status line.** Open tasks show when they're due
  (orange and in words when soon or overdue); a done task says Done, a
  set-aside one Not for me. Titles go muted, never struck through.
- **New tasks are announced, not waited for.** Personalized tasks land in the
  background (minutes after onboarding, then weekly), so the plan shows no
  spinner for them. `useNewTrackerTasks` (on Home and the plan) remembers per
  campaign which task ids this browser already knew, toasts what was added
  ("Added to your plan: …", with "See in plan" from Home), and the plan marks
  those rows New for one visit. A campaign's first read seeds silently.
- **Completion is optimistic.** `useToggleTrackerTaskComplete` writes the
  row's `completed` into the cache before the request lands (rolled back on
  error), so the next-step card can bring the next task forward the moment
  the done one leaves instead of showing it again until the refetch.
- **Non-prod "Generate tasks" override.** `CampaignStrategySection` renders a
  `{!IS_PROD}` button (from `appEnv`) that hits `POST
/v1/campaigns/tracker-tasks/generate` (gp-api 404s it in prod). It exists
  because the weekly generation cron runs in prod only, so dev/qa never generate
  on their own. `useGenerateTrackerTasks` owns the polling: a manual run _appends_
  a new generation (a higher dynamic `max(week)`) rather than emptying the list,
  so `isTrackerGenerating` can't see it — the hook captures the pre-dispatch
  generation as a baseline, reports `isGenerating` until a dynamic row past that
  baseline lands, and fast-polls (`POLL_INTERVAL_MS`) meanwhile.
  Note the run is async (a CAP dispatch); on localhost the agent infra usually
  isn't running, so nothing lands — this is primarily a deployed dev/qa affordance.

## Gotchas

- **Date strings come in two shapes, always parse as LOCAL midnight.** The
  catalog fallback emits date-only (`2026-07-11`); the tracker/API emits full ISO
  at UTC midnight (`2026-07-11T00:00:00.000Z`). Both `formatTaskDate` (the chip)
  and `buildActiveWeeks` (`localMidnight`) slice to the date portion before the
  Safari-safe dash->slash parse. This is not just Safari-safety: a raw
  `new Date(isoUtc)` is UTC midnight, which in US timezones is the _previous_ day
  locally, so the week navigator would bucket a task into the wrong calendar week
  (and disagree with its own date chip). Keep any new date parsing tolerant of
  both shapes and anchored to local midnight.
- `useTrackerTasks` can't tell "generation failed/never-dispatched" from "still
  generating" (no backend signal yet); the fast-poll budget caps the cost, but
  the "setting up" spinner can still persist for a campaign whose dispatch
  genuinely no-ops (e.g. missing raceId/clerkId/name). A backend
  generation-status signal (+ a UI timeout) is the real fix and remains a
  follow-up.
- **There is no `loading.tsx` in the `campaign-plan/` route segment** (removed on
  purpose). It rendered a bare full-screen `RouteLoading` with no dashboard
  shell, so every tab click flashed the whole page — including the sidebar — into
  a spinner, unlike the other dashboard tabs. Without it the App Router keeps the
  current page (sidebar and all) mounted during the `force-dynamic` server
  round-trip and swaps only the content, matching the other tabs. Don't
  reintroduce a segment `loading.tsx` here unless it renders inside
  `DashboardLayout`.
