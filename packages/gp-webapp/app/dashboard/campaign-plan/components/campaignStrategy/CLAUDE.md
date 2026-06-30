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
| `CampaignStrategyPhase.tsx` | A phase accordion item + the "N more unlock" hint. |
| `campaignStrategy.types.ts` | Render-shape types shared by both builders. |

## Patterns / non-obvious logic

- **Render only the latest generation.** The backend appends each weekly run as
  a new `week`; `buildTrackerStrategy` filters dynamic rows to `max(week)` (plus
  the non-generational static rows). This MUST match the digest's scoping in
  gp-api, or the page and the email disagree.
- **Phase status has two axes.** `done` = every task in the phase completed;
  "happening now" (active) is date-driven (the first non-empty phase still in
  play). Empty intermediate phases are skipped so they can't strand a later
  populated phase as `upcoming`.
- **No per-week display cap:** every phase renders all of its tasks at once
  (the page shows everything; the weekly digest is what caps at 3). GOTV is the
  one gated phase: hidden behind a window message until the election is within
  30 days. That gate is deterministic here, not in the agent.
- **The section renders only for the story cohort, only from persisted rows.**
  `CampaignPlanView` branches on the `campaign-story` flag: story cohort gets
  the tracker, story-off gets the legacy plan content (incl. community events)
  with no tracker. There is no client-catalog fallback. When the fetch settles
  with no rows the section shows a "setting up your tracker" state (bootstrap in
  flight), since a rendered story-cohort campaign always bootstraps.

## Gotchas

- **Date strings come in two shapes.** The catalog fallback emits date-only
  (`2026-07-11`); the tracker/API emits full ISO (`2026-07-11T00:00:00.000Z`).
  `formatTaskDate` slices to the date portion before the Safari-safe
  dash->slash parse. The full-ISO form would otherwise be an Invalid Date and
  `format()` would throw, crashing the row. Keep any new date parsing tolerant
  of both.
- `useTrackerTasks` can't tell "generation failed/never-dispatched" from "still
  generating" (no backend signal yet); the fast-poll budget caps the cost, but
  the spinner can persist for a malformed campaign. Backend signal is a follow-up.
