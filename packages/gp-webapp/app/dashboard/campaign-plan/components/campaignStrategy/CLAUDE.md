# campaignStrategy/ (Campaign Tracker rendering)

Renders the Campaign Plan page's task rail (Campaign Tracker v3, ENG-10406):
four phases (preLaunch / launch / active / gotv) of dated, prioritized task
cards the candidate checks off. Feature overview + backend:
`docs/features/campaign-tracker-v3.md` and
`packages/gp-api/src/campaigns/campaignTracker/CLAUDE.md`.

## Key files

| File | Role |
|------|------|
| `useTrackerTasks.ts` | Fetches `/campaigns/tracker-tasks`; exposes `isGeneratingDynamic`; fast-polls (20s) while generating, slow background poll after, with a fast-poll budget cap. |
| `buildTrackerStrategy.ts` | Builds the render shape from persisted rows (the only path). |
| `CampaignStrategySection.tsx` | The section: loading / error / setting-up / generating states, then the accordion. Renders only from persisted rows. |
| `CampaignStrategyTaskRow.tsx` | One task card (date chip, channel icon, completion toggle). |
| `CampaignStrategyPhase.tsx` | A phase accordion item; the Active phase renders the `WeekNavigator` (one Mon-Sun week, back/forward one). |
| `campaignStrategy.types.ts` | Render-shape types (`CampaignStrategyPhase`, `…Week`, `…Task`). |

## Patterns / non-obvious logic

- **Render only the latest generation.** The backend appends each weekly run as
  a new `week`; `buildTrackerStrategy` filters dynamic rows to `max(week)` (plus
  the non-generational static rows). The Active week navigator (`buildActiveWeeks`)
  shows, per week, that week's dynamic-latest-gen tasks plus the deterministic
  `isDefaultTask` outreach dated in it. The gp-api weekly digest mirrors that
  active-week set (dynamic + text/robocall outreach, not the setup checklist), so
  keep the two in sync or the page and the email disagree.
- **Phase status has two axes.** `done` = every task in the phase completed;
  "happening now" (active) is date-driven (the first non-empty phase still in
  play). Empty intermediate phases are skipped so they can't strand a later
  populated phase as `upcoming`.
- **Pre-launch / Launch render all tasks; Active is a week navigator.** No
  progressive-reveal cap (the weekly digest is what caps at 3). The Active phase
  is built by `buildActiveWeeks`: it buckets every active task (all generations,
  not just `max(week)`) into Monday-Sunday weeks, flags the week containing
  today, and `CampaignStrategyPhase`'s `WeekNavigator` shows one week at a time,
  bounded to the current week ±1 (older generations stay out of reach). GOTV is
  the one gated phase: hidden behind a window message until the election is
  within 30 days. Both the navigator window and the GOTV gate are deterministic
  here, not in the agent.
- **The section renders only for the story cohort, only from persisted rows.**
  `CampaignPlanView` branches on the `campaign-story` flag: story cohort gets
  the tracker, story-off gets the legacy plan content (incl. community events)
  with no tracker. There is no client-catalog fallback. When the fetch settles
  with no rows the section shows a "setting up your tracker" state (bootstrap in
  flight), since a rendered story-cohort campaign always bootstraps.

## Gotchas

- **Date strings come in two shapes, always parse as LOCAL midnight.** The
  catalog fallback emits date-only (`2026-07-11`); the tracker/API emits full ISO
  at UTC midnight (`2026-07-11T00:00:00.000Z`). Both `formatTaskDate` (the chip)
  and `buildActiveWeeks` (`localMidnight`) slice to the date portion before the
  Safari-safe dash->slash parse. This is not just Safari-safety: a raw
  `new Date(isoUtc)` is UTC midnight, which in US timezones is the *previous* day
  locally, so the week navigator would bucket a task into the wrong calendar week
  (and disagree with its own date chip). Keep any new date parsing tolerant of
  both shapes and anchored to local midnight.
- `useTrackerTasks` can't tell "generation failed/never-dispatched" from "still
  generating" (no backend signal yet); the fast-poll budget caps the cost, but
  the spinner can persist for a malformed campaign. Backend signal is a follow-up.
