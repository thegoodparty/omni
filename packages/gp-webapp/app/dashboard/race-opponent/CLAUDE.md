# app/dashboard/race-opponent/ — Know Your Opponent (frontend)

The candidate-facing opposition-research surface. Backed by the gp-api `raceOpponent`
module (`packages/gp-api/src/raceOpponent/CLAUDE.md` — read it for the two-engine
split, gating, and the experiments). Flag-gated (`win-know-your-opponent`) and
Pro-gated. Built across four epics (P0 ENG-10525 → P4 ENG-10604).

## Routes

| Route                                    | File                     | Renders                                                                                        |
| ---------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------- |
| `/dashboard/race-opponent`               | `page.tsx`               | The opponent list / state machine (`RaceOpponentList`) — the main surface                      |
| `/dashboard/race-opponent/opponents`     | `opponents/page.tsx`     | Strict-engine opponent research (`OpponentResearch`); routes back to self-research if not done |
| `/dashboard/race-opponent/self-research` | `self-research/page.tsx` | The candidate's own self-research pass (`SelfResearch`) — the front door to the strict engine  |

All three are Server Components that resolve gating server-side (see below) and then
render their client component inside `<FeatureFlagGuard flagKey={KNOW_YOUR_OPPONENT_FLAG_KEY}>`.

## Gating (the precedence ladder)

Resolved in `page.tsx` + `RaceOpponentList`. Get the order right or a just-upgraded
user flickers into the wrong state on first paint:

```
flag off                          → no nav item, no page (FeatureFlagGuard hides/bounces)
flag on, !isPro                   → <OpponentProLockedView/> (in-page upgrade pitch, NOT a redirect)
flag on, isPro:
  running/discovering, idle-mid-  → <OpponentResearchProgress/>   (4-step cosmetic screen)
    run, or never-ran auto-start
  completed, opponents > 0        → the report (list + threat tiers + issue contrasts)
  settled empty, non-failed       → <AddOpponentsForm/>  (manual entry, shown directly) —
    (completed-0 OR uncontested       "we looked and found nobody, add them by hand"
     idle that already ran)
  failed                          → failure card + "Try again" (re-dispatches collect)
```

There is **no "Collect now" / "Refresh" control** and no idle "start" prompt: a Pro
user who lands with the agent never having run auto-starts the flow (see below). The
only manual paid trigger left is the `AddOpponentsForm` submit ("Run the analysis").

- **The flag gates the ENTIRE surface, the locked view included.** Flag-off must show
  nothing (per ENG-10608 AC) — the non-Pro `OpponentProLockedView` stays _inside_
  `FeatureFlagGuard`. Do NOT render it unconditionally; that would expose a gated,
  unreleased feature to every non-Pro candidate.
- The nav item (`DashboardMenu.tsx`) shows for flag-on users regardless of Pro; Pro is
  gated at the route **content**, not the nav entry.

## Components (by epic / role)

- **List + state machine**: `RaceOpponentList.tsx` (the orchestrator — owns the poll,
  status, and the precedence ladder above).
- **Activation/UX (P4)**: `OpponentProLockedView`, `AddOpponentsForm`,
  `OpponentResearchProgress`.
- **Analytical view (P3)**: `OpponentOverviewCard`, `ThreatTierBadge`,
  `IssueContrastCard`, `OpponentHandbook`, `OpponentSection`, `OpponentPageHeader`,
  `OpponentBadge`.
- **Strict engine (P1)**: `OpponentResearch`, `SelfResearch`, `SelfResearchIntakeForm`,
  `SelfResearchReport`, `ContrastList`, `ContrastCard`, `RegenerateContrasts`,
  `SourceAttribution`, `OpponentActivityFeed`.

## Status polling — one poller, it is the source of truth

`RaceOpponentList` polls `GET /v1/campaigns/mine/race-opponent` every
`POLL_INTERVAL_MS` (5000) while status is `running`/`discovering`. **Do not add a
second poller.** The 4-step processing screen's step counter is a **cosmetic
timer**, fully decoupled from the real poll — the timer animates labels; the real poll
decides when to leave the screen. Never transition to the report off the fake timer
alone.

`collectionStatus` enum: `idle | discovering | running | completed | failed` (there is
no `queued`).

## Auto-start on mount (never-ran Pro users)

A Pro user can reach this page with the agent never having run — e.g. a legacy Pro
who upgraded before the pro-upgrade auto-dispatch (ENG-10605) shipped. Rather than a
manual "start" control, `RaceOpponentList` auto-fires `collect()` **once per mount**
(`autoStartedRef`) when `neverRan = status === 'idle' && lastCollectedAt === null`, and
holds the processing screen while that's pending (`autoStartPending`). This is safe
against stacking paid runs: `/collect` is **idempotent** against the server-side
`oppositionPersistedAt` marker — an already-discovered uncontested race (also idle +
`lastCollectedAt` null on the FE) returns `idle` WITHOUT dispatching a fresh run. Such
a race settles back to idle and the manual `AddOpponentsForm` takes over — it does NOT
wedge on the processing screen. Do **not** re-fire on every idle render; the ref is
the guard.

## Two-call discovery + the idle-mid-run gap (subtle)

Discovery and collection are two dispatches. When discovery finishes, status briefly
reads `idle` before the auto-fired collect flips it to `running`. `RaceOpponentList`
treats that transient `idle` as still-processing (`idleMidRun = status === 'idle' &&
(justLeftDiscovery || collecting)`) so the screen doesn't flicker out. `collect()` also
races a 30s deadline + re-sync so a hung POST can't strand the user mid-run.

## Analytics (`helpers/analyticsHelper.ts`, `EVENTS.RaceOpponent`)

Fire via `trackEvent`, once per trigger: `Win - Opponent Upgrade Viewed` (locked view
mount), `Win - Opponents Manually Added` (manual submit, with `opponentCount`),
`Win - Opponent Research Started` (a run starts — ref-guarded + seeded from
`initialData` so a mid-run reload doesn't over-count), plus `OpponentProfileViewed`,
`OpponentsManuallyAdded`, contrast events. Governance metadata for new events: the
`event-metadata` skill (Amplitude).

## Gotchas

- **All three routes gate**: removing the redirect in `page.tsx` only is not enough —
  `opponents` and `self-research` deep links must gate too, or a non-Pro user bounces.
- `*.test.tsx` must `import { describe, it, expect, vi } from 'vitest'` (CI tsc fails
  without it even when local run passes via globals).
- Components with hooks/timers/state need `'use client'`.
- Long opponent URLs in the manual form must wrap (`min-w-0 break-words`) — see the
  StyledAlert/grid overflow gotcha in the gp-webapp root doc.
- Add new API routes to `gpApi/api-endpoints.ts`; keep client URL validation in
  lockstep with the server (https-only, name required, 1–10 cap for manual opponents).
