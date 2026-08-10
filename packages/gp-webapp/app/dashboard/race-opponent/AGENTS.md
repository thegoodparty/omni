# app/dashboard/race-opponent/ — Know Your Opponent (frontend)

The candidate-facing opposition-research surface. Backed by the gp-api `raceOpponent`
module (`packages/gp-api/src/raceOpponent/CLAUDE.md` — read it for the two-engine
split, gating, and the experiments). Pro-gated (the `win-know-your-opponent` flag
was removed after full rollout). Built across four epics (P0 ENG-10525 → P4
ENG-10604).

## Routes

| Route                                    | File                     | Renders                                                                                        |
| ---------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------- |
| `/dashboard/race-opponent`               | `page.tsx`               | The opponent list / state machine (`RaceOpponentList`) — the main surface                      |
| `/dashboard/race-opponent/opponents`     | `opponents/page.tsx`     | Strict-engine opponent research (`OpponentResearch`); routes back to self-research if not done |
| `/dashboard/race-opponent/self-research` | `self-research/page.tsx` | The candidate's own self-research pass (`SelfResearch`) — the front door to the strict engine  |

All three are Server Components that resolve gating server-side (see below).

## Gating (the precedence ladder)

Resolved in `page.tsx` + `RaceOpponentList`. Get the order right or a just-upgraded
user flickers into the wrong state on first paint:

```
!isPro                            → <OpponentProLockedView/> (in-page upgrade pitch, NOT a redirect)
isPro:
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

- The nav item (`DashboardMenu.tsx`) shows for every Win campaign regardless of Pro;
  Pro is gated at the route **content**, not the nav entry.

## Components (by epic / role)

- **Page shell**: `page.tsx` sets `DashboardLayout`'s `navHeader`
  (`{ icon: 'flag', label: NAV_LABELS.knowYourOpponent }`) — the shared
  `DashboardNavHeader` bar every main nav page uses, with Voter Data as the
  reference. This **reverted** the feature-local styleguide `PageHeader` bar
  (ENG-10633/10638): that bar had drifted from the sidebar tab on both icon
  (swords vs. the nav item's flag) and type scale (`text-sm` vs. the shared
  bar's `text-base`), and its `mx-auto max-w-[608px]` content column left the
  title indented while every other page's was flush at `px-6`. Icon key and
  label now come from `shared/navLabels.ts`, the same source `DashboardMenu`
  reads, so they can't drift again — change the nav item and the bar follows.
  Both branches pass the same config: whether a CTA sits in the bar is the bar's
  own business (it counts mounted `DashboardNavHeaderAction`s), so the report
  state's "Export brief" shows there while the locked, processing, and empty
  states leave the bar action-free without a per-branch flag. The bar's title is
  desktop-only: on mobile it lives in
  `MobileMenuTrigger`'s top bar via this route's `MOBILE_PAGE_TITLES` entry in
  `DashboardLayout` — keep that entry, or mobile loses its title. Everything
  below the bar (locked view or `RaceOpponentList`) sits in a
  `flex-1 bg-muted px-4 py-6 lg:px-8` body that fills the viewport below the
  bar (the `DashboardLayout` wrapper gets `flex flex-col` via
  `wrapperClassName`, so short states like the processing screen don't show
  the layout's `#f5f5f5` bg as a seam under the muted body); each state
  centers itself in that body
  with its own `mx-auto max-w-*` (608px for the report/processing screen, 560px
  for the locked view and the manual-entry form) rather than the shell
  dictating one width for all of them.
- **List + state machine**: `RaceOpponentList.tsx` (the orchestrator — owns the poll,
  status, and the precedence ladder above). Owns the "N candidates filed for
  this seat" field-header row (heading + subtitle) and the icon-only round
  "Export brief" button (`aria-label="Export brief"`), which is no longer in
  that row: it renders through `DashboardNavHeaderAction` so it sits top right
  in the page title bar, where Voter Data puts its primary action. Sized
  `!h-8 !w-8` to clear the bar's fixed `h-14`. It stays inside the report
  branch, so the locked/processing/empty states show no CTA. It takes two page-computed strings:
  `racePlace` (office/district, feeds the subtitle; falls back to "in your
  race" when absent) and `raceContext` (place + election date, feeds only the
  PDF export header).
- **Activation/UX (P4)**: `OpponentProLockedView`, `AddOpponentsForm`,
  `OpponentResearchProgress`.
- **Opponent card v2 (P5, ENG-10635)**: `OpponentOverviewCard` (the accordion
  trigger row) + `ThreatTierBadge` (a colored dot + label, right-aligned on
  the row — `bg-primary`/`text-primary` for the primary threat, `bg-warning-600`
  or `bg-muted-foreground/50` + `text-foreground` for the other two tiers).
  `RaceOpponentList`'s expanded detail body (`OpponentDetailBody` →
  `OpponentSummaryView`) is a **flat stack of sections** — no nested
  Accordion/Collapsible inside. Sections, each rendered only when its field is
  non-null (sourced-or-silent): overview (no heading) + an optional "Campaign
  website" link (`opponent.websiteUrl`) + its `SourceRow`; "Why they're
  running" (interpretive, no sources); "Their background" (its own
  `SourceRow` — `background.sources` is independent of `overview.sources`
  and can cite different documents, so each sourced section renders its own
  citations); "Issues that
  matter most to them" (a bulleted list + its own `SourceRow`). A legacy
  summary with only the pre-v2 fields renders just overview + background — the
  retired sections (why they matter most, what you need to know, where
  they're soft, per-opponent contrasts, key positions) never render again,
  even off a summary row that still carries those deprecated fields.
  `IssueContrastCard` and `OpponentSection` were deleted in this pass (their
  only callers were the retired sections). `OpponentHandbook` (P3, unrelated
  strict-engine surface) is untouched.
- **PDF export (P4/P5, ENG-10637)**: `pdf/` — the field header's "Export brief"
  button downloads one PDF holding a brief per opponent that has a summary.
  `opponentBriefContent.ts` is the pure page→PDF mapping (mirrors
  `OpponentSummaryView`'s section conditionals 1:1 — overview |
  whyTheyreRunning | background | issuesThatMatter, in that order; a legacy
  summary with only the pre-v2 fields falls back to overview + background,
  same as the page). Reuses `descriptorFor` +
  `threatTierLabel` for the snapshot line. It renders **only what the page
  shows** — no finance, no issue `salience` label, no recommended actions
  (those are Lovable-sample extras our page never renders), and none of the
  card-v2-retired sections (why they matter most, what you need to know,
  where they're soft, per-opponent contrasts, key positions). Sourced sections
  print a compact `source:` line per citation (`publisher — url`, description
  omitted, no hover carousel) — this is the one place in the feature that
  reads `RaceOpponentSummarySourceRef.url` **without** the `sourceUrl ??`
  legacy fallback (rich-first now that the wire always backfills `url`); see
  the transitional-type gotcha below.
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
  counter, and an external-link to the source currently shown. Opens on hover
  and keyboard focus (a real `<button>` via `HoverCardTrigger asChild`, not
  `HoverCardTrigger`'s own default `<a>`, so it's focusable and has the right
  semantics); tap opens it only where the browser focuses buttons on tap —
  Radix HoverCard ignores touch pointerenter and iOS Safari doesn't focus
  buttons on tap, so the mobile affordance is an ENG-10635/QA concern.
  `SourceChip` also accepts a `nonLinkedSource` — a leading entry with no URL
  that renders in the chip and carousel without an anchor (added for the
  removed field SWOT's "Good Party internal data" citation; no production
  caller today, kept for the next sourced-but-unlinked section). It intentionally does NOT converge
  with `app/shared/citations/SectionSourcePills.tsx` (the briefings pill +
  single-source popover): the HoverCard + carousel design is pinned by the
  Phase 5 Lovable design, so keep the components separate — they do share the
  `hostnameFromUrl`/`sourceInitial` helpers from
  `@shared/briefings/displaySource`. ENG-10635 wired `SourceRow` into the
  opponent card's detail body (overview, background, and issues-that-matter
  citations) via the `RaceOpponentSummarySourceRef`/`SummarySource` rich
  fields (`url` directly, no `sourceUrl ??` fallback). `SourceAttribution` (the old
  `source: <url>` line) has no production callers left on this page — it was
  only used by the now-deleted `IssueContrastCard` and the old merged-overview
  renderer — but stays in the tree (its own test still exercises it)
  following the same "kept for a future pass" precedent as
  `ContrastList`/`RegenerateContrasts` above.
- **Field SWOT (P5 ENG-10636, removed P6 ENG-10661)**: the campaign-level SWOT
  ("How your campaign stacks up against the field") no longer renders anywhere
  — `FieldAnalysisSection` (+ its test) and the PDF's `buildFieldAnalysisBrief`
  block were deleted. UI-only removal: gp-api still produces and serves
  `fieldAnalysis`, so the `RaceOpponentFieldAnalysis` mirror type and the
  `fieldAnalysis` response field stay in `gpApi/api-endpoints.ts` (nothing
  reads them). `TrendingUpIcon`/`OctagonAlertIcon` stay in
  `packages/styleguide/src/components/ui/icons.tsx` (curated catalog).
- **Stand-out actions (P6, ENG-10650)**: `StandoutActionsSection` renders the
  "N ways to stand out" action cards below the roster in
  `RaceOpponentList`, reading `data.standoutActions`
  (`RaceOpponentStandoutAction` in `gpApi/api-endpoints.ts`, mirroring
  `RaceOpponentStandoutActionSchema` in contracts; the contract defaults the
  array to `[]`, the mirror keeps it optional for older payloads). A client
  component (`'use client'` — the CTA uses `useRouter`). Each card: SendIcon +
  "Voter outreach" eyebrow, title, body (rendered verbatim — no truncation),
  and a full-width primary "Send SMS to voters" `Button` that pushes
  `/dashboard/outreach?compose=text&message=<encodeURIComponent(smsMessage)>`
  — the outreach text composer opens with the message preset behind the same
  Pro/compliance gates as the manual path (the Lovable sample's sidebar
  interaction is wrong per the PO; the CTA navigates). Renders nothing for an
  absent/empty `standoutActions` (actions run in flight or failed — the brief
  ends at the roster). Fires the two ENG-10651 events (see Analytics below):
  viewed once per mount when cards render (ref-guarded against the 5s poll),
  clicked on each CTA press before the `router.push`.

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
`OpponentsManuallyAdded`, contrast events. Stand-out actions (ENG-10651, fired from
`StandoutActionsSection`, never from `RaceOpponentList`, so an absent section can't
fire): `Win - Opponent Standout Actions Viewed` (once per mount when cards render,
ref-guarded against the 5s poll; `campaignId`, `actionCount`) and
`Win - Opponent Standout Action Clicked` (each CTA press, before the push;
`campaignId`, `order`, `issue`, `messageLength`, plus `opponentName` — the key is
omitted, not null, when the card has none). The clicked event is the
race-opponent half of the SMS funnel; the outreach side fires
`EVENTS.Outreach.ClickCreate` with `source: 'deep_link'` when the composer opens
(ENG-10649) — don't double-fire it here. Governance metadata for new events: the
`event-metadata` skill (Amplitude).

## Gotchas

- **All three routes gate**: removing the redirect in `page.tsx` only is not enough —
  `opponents` and `self-research` deep links must gate too, or a non-Pro user bounces.
- `*.test.tsx` must `import { describe, it, expect, vi } from 'vitest'` (CI tsc fails
  without it even when local run passes via globals).
- Components with hooks/timers/state need `'use client'`.
- Long opponent URLs in the manual form must wrap (`min-w-0 break-words`) — see the
  StyledAlert/grid overflow gotcha in the gp-webapp root doc.
- `RaceOpponentSummarySourceRef` in `gpApi/api-endpoints.ts` is still transitional:
  the rich fields (`url`/`title`/`publisher`) are required (the contract
  backfills them for legacy rows), and `sourceType`/`sourceUrl` stay optional —
  gp-api still sends them. Neither `RaceOpponentList` (ENG-10635) nor the PDF
  export (`opponentBriefContent`'s `formatSourceLine`, ENG-10637) reads the
  legacy fallback anymore — both key off `.url` directly, since the contract
  always backfills it. Don't drop `sourceType`/`sourceUrl` from the mirror type
  or the contract until every consumer of the legacy shape (gp-api's
  producers/back-compat readers) is confirmed off it.
- Add new API routes to `gpApi/api-endpoints.ts`; keep client URL validation in
  lockstep with the server (https-only, name required, 1–10 cap for manual opponents).
- `api-endpoints.ts`'s `RaceOpponentSummary`/`RaceOpponentResponse` mirrors add
  v2 fields incrementally per ticket (`whyTheyreRunning`/`issuesThatMatter`/
  `websiteUrl` landed with ENG-10635; `fieldAnalysis` is ENG-10636's field, not
  added here) — when adding a mirror field, scope it to the ticket that reads
  it rather than mirroring the whole contract shape at once, to avoid
  cross-ticket merge conflicts on this shared file.
