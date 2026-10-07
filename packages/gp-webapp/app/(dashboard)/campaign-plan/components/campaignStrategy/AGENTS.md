# campaignStrategy/ (Campaign Tracker rendering)

Renders the Game Plan page's task rail (Campaign Tracker v3, ENG-10406):
four phases (preLaunch / launch / active / gotv) of dated, prioritized task
cards the candidate checks off. Feature overview + backend:
`docs/features/campaign-tracker-v3.md` and
`packages/gp-api/src/campaigns/campaignTracker/CLAUDE.md`.

## Key files

| File                          | Role                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useTrackerTasks.ts`          | Fetches `/campaigns/tracker-tasks`; exposes `isGeneratingDynamic`; fast-polls (20s) while the tracker is _settling_ (`isTrackerSettling`: no rows yet **or** static-only with dynamic still generating), slow background poll after, with a fast-poll budget cap; refetches on mount + window focus (and polls in the background) so navigating to the tab surfaces freshly materialized rows without a manual refresh.  |
| `buildTrackerStrategy.ts`     | Builds the render shape from persisted rows (the only path).                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `CampaignStrategySection.tsx` | The section: loading / error / setting-up / generating states, then `PlanProgress` and the accordion. Renders only from persisted rows.                                                                                                                                                                                                                                                                                                                                                                              |
| `CampaignStrategyTaskRow.tsx` | One task row (date chip, channel icon, title, description, link) with a "…" menu: Mark done (Mark not done once done), Later and Not for me, the same choices as Home's card.                                                                                                                                                                                                                                                                                                                                                                                                                                       |
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
  Only the story task sets `cta` today ("Add your story"), and it has to match
  the card pinned above the rail; the manager's task list prefers the same
  column. Before this the tracker hardcoded "Open" for every linked row, so a
  row could disagree with the surface next to it.
- **Phase status has two axes.** `done` = every task in the phase completed
  or set aside as "not for me"; "happening now" (active) is date-driven (the
  first non-empty phase still in play). Empty intermediate phases are skipped so
  they can't strand a later populated phase as `upcoming`.
- **"Do this next" is not decided here.** `buildTrackerStrategy` flags the
  task `selectNextTrackerTask` (contracts) picks, the same call Home's
  `NextThingCard` makes, so the plan and Home can never point at different
  tasks. It is plan order, earliest first, with ballot access leading for a
  candidate who is not `on-ballot`; done, snoozed (`later`) and `notForMe`
  tasks are passed over, as is an event or scheduled send whose date has gone.
  A `notForMe` row stays in its phase, muted, with an Undo.
- **Pre-launch / Launch render all tasks; Active is a week navigator.** No
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
- **The page shows where the candidate is, not a wall of rows.** `PlanProgress`
  sits above the phases: one bar per phase filled by how much is handled
  (done or set aside), "You're in <phase>" on the phase holding the next task,
  and an overall "x of y done". Each phase header carries its own count
  (`phaseProgress.ts` holds the counting both use). Only the phase holding the
  next task and the one happening now open by default.
- **The next task is Home's card, in its place in the list.**
  `CampaignStrategyTaskRow` renders `NextThingCard surface="plan"` instead of
  a row for the `isNext` task. The card picks its task through the same
  `selectNextTrackerTask`, so the two agree, and `surface` rides its events so
  Home and the Game Plan can be told apart.

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
