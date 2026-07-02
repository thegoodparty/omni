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

- **Page shell (P5, ENG-10633)**: `page.tsx` renders the shared styleguide
  `PageHeader` (heading "Know Your Opponent", `leading` overridden to the same
  swords icon as the `DashboardMenu` nav item) as a full-bleed top bar — this
  replaced the old feature-local `OpponentPageHeader` (deleted) and the
  `DashboardLayout` `navHeader` prop for this route. The bar lives INSIDE
  `FeatureFlagGuard` on both branches: the flag gates the entire surface, so
  flag-off must ship no trace of the feature — the heading included — in the
  SSR HTML. The bar is desktop-only
  (`max-lg:hidden`), like the `DashboardNavHeader` it replaced: on mobile the
  title lives in `MobileMenuTrigger`'s top bar via this route's
  `MOBILE_PAGE_TITLES` entry in `DashboardLayout` — keep that entry, or mobile
  loses its title; drop the `max-lg:hidden`, and mobile shows two stacked title
  bars. Everything below it (locked view or `RaceOpponentList`) sits in a
  `bg-muted px-4 py-6 lg:px-8` body; each state centers itself in that body
  with its own `mx-auto max-w-*` (608px for the report/processing screen, 560px
  for the locked view and the manual-entry form) rather than the shell
  dictating one width for all of them.
- **List + state machine**: `RaceOpponentList.tsx` (the orchestrator — owns the poll,
  status, and the precedence ladder above). Owns the "N candidates filed for
  this seat" field-header row (heading + subtitle + the icon-only round
  "Export brief" button, `aria-label="Export brief"`) — there is no separate
  page-level header component anymore. It takes two page-computed strings:
  `racePlace` (office/district, feeds the subtitle; falls back to "in your
  race" when absent) and `raceContext` (place + election date, feeds only the
  PDF export header).
- **Activation/UX (P4)**: `OpponentProLockedView`, `AddOpponentsForm`,
  `OpponentResearchProgress`.
- **Analytical view (P3)**: `OpponentOverviewCard`, `ThreatTierBadge` (a colored
  dot + label, right-aligned on the roster row — "Main threat" reads in blue),
  `IssueContrastCard`, `OpponentHandbook`, `OpponentSection`.
- **PDF export (P4)**: `pdf/` — the field header's "Export brief" button downloads
  one PDF holding a brief per opponent that has a summary. `opponentBriefContent.ts`
  is the pure page→PDF mapping (mirrors `OpponentSummaryView`'s section conditionals;
  reuses `descriptorFor` + `threatTierLabel` for the snapshot line). It renders
  **only what the page shows** — no finance, no issue `salience` label, no
  recommended actions (those are Lovable-sample extras our page never renders).
- **Strict engine (P1)**: `OpponentResearch`, `SelfResearch`, `SelfResearchIntakeForm`,
  `SelfResearchReport`, `ContrastList`, `ContrastCard`, `RegenerateContrasts`,
  `SourceAttribution`, `OpponentActivityFeed`. `ContrastList`/`RegenerateContrasts`
  (the "Review your contrasts" section) are currently unreferenced by any route —
  ENG-10633 dropped them from this page's composition on purpose (the redesign has
  no contrasts section here) and no other route has picked them up yet; kept in
  the tree for the strict engine's next UI pass rather than deleted.
- **Source citations v2 (P5, ENG-10634)**: `SourceChip` + `SourceRow` are the
  redesigned citation primitive — a compact chip (favicon-letter + domain +
  "+N") that opens a Radix `HoverCard` carousel over every cited source
  (`SummarySource` from `@goodparty_org/contracts`), with prev/next, a "1/N"
  counter, and an external-link to the source currently shown. Opens on hover,
  keyboard focus, and tap (a real `<button>` via `HoverCardTrigger asChild`, not
  `HoverCardTrigger`'s own default `<a>`, so it's focusable and has the right
  semantics). `SourceChip` also accepts a `nonLinkedSource` — a leading entry
  with no URL (e.g. the field-SWOT's "Good Party internal data" citation) that
  renders in the chip and carousel without an anchor. Not yet wired into the
  page: it lands standalone here so ENG-10635/ENG-10636 can consume it without
  redoing the citation UI; `SourceAttribution` (the old `source: <url>` line)
  keeps rendering on this page until ENG-10635 swaps it out — don't delete
  `SourceAttribution`, the strict-engine surfaces above still use it.

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
- `RaceOpponentSummarySourceRef` in `gpApi/api-endpoints.ts` is transitional: the
  rich fields (`url`/`title`/`publisher`) are required (the contract backfills
  them for legacy rows), but `sourceType`/`sourceUrl` are optional — gp-api still
  sends them today, but ENG-10635 will stop. Existing readers (`RaceOpponentList`,
  `IssueContrastCard`, `OpponentBriefPdfDocument`, `opponentBriefContent`) fall
  back with `source.sourceUrl ?? source.url` rather than assuming `sourceUrl` is
  present — keep that pattern in any new reader until ENG-10635 migrates
  everything onto the rich fields and the legacy two are dropped.
- Add new API routes to `gpApi/api-endpoints.ts`; keep client URL validation in
  lockstep with the server (https-only, name required, 1–10 cap for manual opponents).
