# src/raceOpponent/ — Know Your Opponent (backend)

Opposition research for Win candidates: collect public, **sourced** facts on the
opponents in a race, turn them into candidate-facing analysis, and pair them with
the candidate's own positions as ready-to-send **contrasts**. Pro-gated (the
`win-know-your-opponent` flag was removed after full rollout). Built across four
epics (P0 ENG-10525 → P4 ENG-10604); the tech design lives at ClickUp doc
`2ky4jq2q-91513`.

## The one thing to understand first: two engines coexist here

This module contains **two distinct pipelines** that share a controller and the
`assertAccess` gate but otherwise do not interact. Conflating them is the most
common mistake.

| | **Relaxed path** (P2/P3/P4) | **Strict engine** (P1) |
|---|---|---|
| Experiments | `race_opponent_collection` → `race_opponent_summary` → `race_opponent_actions` | `self_research` → `opponent_research` |
| What it produces | `RaceOpponent` (raw collected text) + `RaceOpponentSummary` (threat tier, why-it-matters, issue contrasts) | `RaceOpponentResearch` → sourced `RaceOpponentFinding` → `RaceOpponentContrast` |
| Sourcing bar | relaxed — structures already-collected text | **sourced-or-silent**: every finding/contrast carries a `source_url` + extract, grounded by the QA gate |
| What renders it | the live `/dashboard/race-opponent` page (list, threat tiers, issue contrasts) | `OpponentResearch` / contrasts UI (self-research front door, fair-line review) |
| Routes | `collect`, `opponents/manual`, `get` | `self-research/*`, `opponents/identify·research·profile·activity`, `contrasts/*` |
| Self-research gate | **no** (manual entry is the candidate's own input) — except `collect`, which is the functional trigger and IS gated | **yes** — hard 403 until the candidate's self-research pass completes |

The page the candidate actually sees today renders the **relaxed** path. The strict
engine is the sourced contrast system; it stays the untouched "v1" engine. When you
change "opponent research", be explicit about which one.

## Key files

| File | Role |
|------|------|
| `raceOpponent.controller.ts` | All routes (`campaigns/mine/race-opponent`). HTTP only; gating + service dispatch. Heavily commented — the routes are the spec. |
| `raceOpponent.constants.ts` | Experiment-type strings, `MAX_*_ATTEMPTS` caps, `CONTRAST_ALLOWED_CATEGORIES`, `CONTRAST_INFLATION_TERMS`, `DATASET_SOURCE_SCHEMES` |
| `services/raceOpponent.service.ts` | **Relaxed path** + the module's `assertAccess` (Pro). `collect` / `collectManual` / `get`; dispatches the chain and reads the summary |
| `services/raceOpponentRun.ts` | One chain link's newest run from whichever engine's table the switch names, and the one status vocabulary both tables map onto |
| `services/raceOpponentPersist.service.ts` | The chain's writes, shared by both engines' completion paths |
| `services/opponentResearch.service.ts` | **Strict engine** dispatch: `identify` / `start` / `profile`; builds `candidate_platform` from `Website.content.about` (NOT CampaignStory — see ENG-10607) |
| `services/selfResearch.service.ts` | Strict engine front door: `start` / `status` / `report` of the candidate's own pass |
| `services/selfResearchGate.service.ts` | The hard 403 gate (PRD Requirement B). `assertSelfResearchComplete` |
| `services/contrastEngine.service.ts` | Pairs findings with the candidate's positions into contrasts; category allowlist enforced |
| `services/contrastTone.service.ts` | Deterministic inflation-term strip; a draft that still reads near-the-line routes to fair-line review |
| `services/contrastReviewVerdict.service.ts` | Reviewer (Campaign Success, admin-only) applies the fair-line verdict |
| `services/contrastRouting.service.ts` | Route an approved contrast into **Website issues** (legacy: Campaign Story) or a draft texting Outreach — DRAFT only, never sends |
| `services/contrastEdit.service.ts` | Candidate edits draft contrast text before routing |
| `services/raceOpponentActivity.service.ts` | "What's new" finding stream; advances `lastViewedAt` |
| `services/opponentResearchSchedule.service.ts` | `opponentResearchRefreshDaily` pg-boss schedule (Pro campaigns), one `opponentResearchRedispatch` job per row; dispatches `opponent_research` |
| `services/*Persist.service.ts` | Persist helpers exported for reuse (`RaceOpponentPersistService`, `RaceOpponentResearchPersistService`) |

## Routes + gating

Every route is owner-scoped (`@UseCampaign`) and gated by **`assertAccess`**
(Pro). On top of that:

- `collect`, `opponents/identify·research·profile·activity`,
  `contrasts/generate·route·edit` also call
  `selfResearchGate.assertSelfResearchComplete` → **403** until the self-research pass
  is `completed`. `opponents/manual` (confirmed input), `GET contrasts` (read-only
  list — `assertAccess` only), and **`self-research/*`** (the front door for the pass
  itself — gating it here would be circular) do **not**.
- `contrasts/:id/review-verdict` is **admin-only** (`@Roles(admin)`) and intentionally
  skips owner scope — it acts on one contrast across campaigns and needs a reviewer
  identity (no pure-M2M caller).

## Experiments it dispatches (CAP / agentExperiments)

`race_opponent_collection`, `race_opponent_summary`, `race_opponent_actions`,
`self_research`, `opponent_research` — manifests in
`packages/runbooks/experiments/<id>/`. In-flight
dedup on the run table keyed by type+status prevents double paid runs; the
auto-dispatch trigger (Pro upgrade) and the daily cron reuse the same guard. Per-row
lifetime caps (`MAX_SELF_RESEARCH_ATTEMPTS`, `MAX_OPPONENT_RESEARCH_ATTEMPTS`) surface
`retry` instead of looping paid Fargate runs.

**The relaxed chain runs on either engine, per link.** `runsOnGpApi(link)` is read
by every path that touches a chain run: `dispatchChain` picks `AgentsService.run`
or the PMF Engine's `dispatchRun`, `findInFlightChainRun` picks the run table, and
`services/raceOpponentRun.ts` reads the newest run of a link from that same table
(`collectionStatus`, `postCollectionStatus`, and both re-chain readers go through
it). A reader left on the other engine's table sees no run, so the chain looks
idle and the page re-dispatches a paid run — the one mistake that switch exists to
prevent. `self_research` and `opponent_research` stay on the PMF Engine.

The chain passes output stage to stage **through the database, never through the
engine**: a completed collection persists its items and rows replace the
campaign's, then `dispatchSummary` reads those rows back into the summary input; a
completed summary persists `RaceOpponentSummary` rows, then `dispatchActions`
flattens them into the actions input. Each link's `onArtifact` calls the SAME
`persistCollection` / `persistSummary` / `persistActions` body the PMF Engine's
result consumer calls, so a gp-api run lands exactly where a PMF run does. A
completed actions run
persists its cards into `RaceOpponentStandoutAction` (delete+createMany in one
transaction, `order` = artifact index; per-card contract validation drops a bad
card, but a non-empty artifact whose EVERY card fails is malformed and fails the
run without touching prior rows — while a validly-empty `actions: []` clears
them and stays completed). `get()` serves the cards as `standoutActions`,
ordered by `order`, re-validated on read (a bad row is omitted, never thrown).

The chain's agents live next to this module: `raceOpponentCollectionAgent/`,
`raceOpponentSummaryAgent/`, `raceOpponentActionsAgent/`. Collection and summary
are web-tools-only. Actions reads the district's `hs_*` sentiment off
`queryDatabricks`, scoped by the flat `state`/`l2_district_*` params from
`DistrictResolverService` (omitted all-or-nothing), and declares the manifest's
`data_required_unless` so a run that read no data cannot claim district numbers.
Its grant is one table, the row cap, and `dimensions: ['Active']` alone: the
`hs_*` columns are never filtered or grouped, only read inside an aggregate's own
`CASE`, so declaring them would widen the slicing allowlist for nothing. The
`>= 50`/`>= 70` counts are `SUM(CASE WHEN CAST(hs_x AS DOUBLE) >= 50 THEN 1 ELSE
0 END)`, the people-count form the tool shares with the constituent-data tools:
`SUM(hs_x)` and `COUNT_IF` stay refused, and a passing `SUM(CASE ...)` is held to
the cell-size floor as a count of people. Its `WHEN` is a filter, so it may name
only a declared dimension or an `hs_*` score: `AND LALVOTERID <> 'x'` inside the
CASE would otherwise isolate one voter's answer the floor cannot see.

Each link's gp-api completion releases the next one from `onArtifact` and from
`onFailure`, and both re-chains exclude their own run id: the engine calls them
before the run is marked terminal, so the finishing row still looks in flight and
would answer its own dedup. A summary run also skips a collected source the
summary input schema cannot accept (a non-http URL, empty text) rather than
failing the whole dispatch for it.

## Sourced-or-silent + fair-line (the strict engine's invariants)

- **Sourced-or-silent**: a finding/contrast with no real source is dropped, not shown.
  Grounding is the broker/QA gate's job (each `source_extract` is substring-checked
  against its cited source). `DATASET_SOURCE_SCHEMES` (e.g. `l2:`) skip the network
  reachability check — a dataset URI is not fetchable.
- **Contrast category allowlist** (`CONTRAST_ALLOWED_CATEGORIES`): only an opponent's
  PUBLIC CONDUCT can become a contrast. Family/health/private life/rumor are off-limits
  **server-side**, not as a prompt suggestion.
- **Tone/fair-line**: `CONTRAST_INFLATION_TERMS` are stripped deterministically; if a
  strip fired, the draft routes to human fair-line review (`pending_review`) rather than
  being returned. The candidate read path (`GET contrasts`) shows cleared/approved/used
  only.

## Prisma models (`prisma/schema/raceOpponent.prisma`)

`RaceOpponent` (relaxed raw text) · `RaceOpponentSummary` (relaxed analysis: threat
tier, issue contrasts) · `RaceOpponentFieldAnalysis` (campaign-level SWOT
`sections`, one row per campaign) · `RaceOpponentStandoutAction` (stand-out
action cards, `@@unique([campaignId, order])`) · `RaceOpponentResearch` (strict pass, `kind`
self|opponent) · `RaceOpponentFinding` (sourced, `source_url` required) ·
`RaceOpponentContrast` (`source_url`, status lifecycle, routing FKs).

## Gotchas

- **`buildPlatform` / `buildCandidatePlatform` read `Website.content.about`, never
  `CampaignStory`** (ENG-10524/10607 moved candidate issues to the Website store). Don't
  reintroduce a `campaignStory.issues` read.
- **`routeToStory` writes to Website issues** and sets `routedWebsiteId`. `routedStoryId`
  + `campaign_story.issues` are **legacy columns kept for rolling-deploy safety**
  (ENG-10603 was expand-only); the destructive drop is a deferred follow-up
  (ClickUp `86aj9z8g4`) that ships only after the expand reaches prod. Don't `select`
  `campaign_story.issues` as a research input.
- **The daily refresh cron dispatches `opponent_research`, not
  `race_opponent_collection`** — they are different experiments and never double-fire the
  relaxed collection.
- **DI cycle**: importing `RaceOpponentService` into `CampaignsService`/`PaymentsModule`
  closes a module cycle. The Pro-upgrade auto-dispatch trigger resolves the service
  lazily via `ModuleRef.get(..., { strict: false })` (see `campaigns.service.ts` /
  `paymentEventsService.ts`).
- **`setIsPro` wraps its read+write in a `Serializable` `$transaction`** so concurrent
  at-least-once Stripe webhook retries can't both detect the `false→true` transition and
  double-dispatch the auto-collection.
