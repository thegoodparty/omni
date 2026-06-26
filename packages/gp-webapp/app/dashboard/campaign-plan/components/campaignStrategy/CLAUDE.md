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
| `buildTrackerStrategy.ts` | Builds the render shape from persisted rows (the canonical path). |
| `buildCampaignStrategy.ts` | Client-side catalog fallback for campaigns with no rows yet. |
| `CampaignStrategySection.tsx` | The section: loading / error / generating states, then the accordion. |
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
- **Progressive reveal** (active / gotv only): show `WEEKLY_LIMIT (3) +
  completedCount`, surface `hiddenCount`. GOTV is gated behind a window message
  until the election is within 30 days. These caps/gates are deterministic here,
  not in the agent.
- **`CampaignStrategySection` only falls back to the catalog once the fetch has
  settled** (not during `isPending`, and an error shows an error state) so the
  tracker doesn't flash non-interactive catalog rows.

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
