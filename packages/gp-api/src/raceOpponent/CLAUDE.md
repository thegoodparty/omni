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
| `services/raceOpponent.service.ts` | **Relaxed path** + the module's `assertAccess` (Pro). `collect` / `collectManual` / `get`; dispatches `race_opponent_collection`, reads the summary |
| `services/opponentResearch.service.ts` | **Strict engine** dispatch: `identify` / `start` / `profile`; builds `candidate_platform` from `Website.content.about` (NOT CampaignStory — see ENG-10607) |
| `services/selfResearch.service.ts` | Strict engine front door: `start` / `status` / `report` of the candidate's own pass |
| `services/selfResearchGate.service.ts` | The hard 403 gate (PRD Requirement B). `assertSelfResearchComplete` |
| `services/contrastEngine.service.ts` | Pairs findings with the candidate's positions into contrasts; category allowlist enforced |
| `services/contrastTone.service.ts` | Deterministic inflation-term strip; a draft that still reads near-the-line routes to fair-line review |
| `services/contrastReviewVerdict.service.ts` | Reviewer (Campaign Success, admin-only) applies the fair-line verdict |
| `services/contrastRouting.service.ts` | Route an approved contrast into **Website issues** (legacy: Campaign Story) or a draft texting Outreach — DRAFT only, never sends |
| `services/contrastEdit.service.ts` | Candidate edits draft contrast text before routing |
| `services/raceOpponentActivity.service.ts` | "What's new" finding stream; advances `lastViewedAt` |
| `services/opponentResearchSchedule.service.ts` | Daily refresh cron (Pro campaigns); dispatches `opponent_research` |
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
`packages/runbooks/experiments/<id>/`. Dispatch goes through
`ExperimentRunsService` (SQS → gp-ai-projects pmf_engine). In-flight
dedup on `ExperimentRun` keyed by type+status prevents double paid runs; the
auto-dispatch trigger (Pro upgrade) and the daily cron reuse the same guard. Per-row
lifetime caps (`MAX_SELF_RESEARCH_ATTEMPTS`, `MAX_OPPONENT_RESEARCH_ATTEMPTS`) surface
`retry` instead of looping paid Fargate runs.

The relaxed pipeline chains: a completed collection persists rows then dispatches
`race_opponent_summary`; a completed summary persists `RaceOpponentSummary` rows
then dispatches `race_opponent_actions` (flat `state`/`l2_district_*` params from
`DistrictResolverService`, omitted all-or-nothing — the dispatch Lambda reserves a
nested `district` param for scope derivation). Each link has a terminal-state
re-chain for a newer upstream run its in-flight dedup skipped, and
`collectionStatus` ignores actions runs entirely. A completed actions run
persists its cards into `RaceOpponentStandoutAction` (delete+createMany in one
transaction, `order` = artifact index; per-card contract validation drops a bad
card, but a non-empty artifact whose EVERY card fails is malformed and fails the
run without touching prior rows — while a validly-empty `actions: []` clears
them and stays COMPLETED). `get()` serves the cards as `standoutActions`,
ordered by `order`, re-validated on read (a bad row is omitted, never thrown).

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
