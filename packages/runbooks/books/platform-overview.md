# Platform Overview

Quick reference for the complete GoodParty tech ecosystem. No sensitive values — only references to where they live.

## Monorepo (omni)

Most product code now lives in a single npm-workspaces monorepo: **omni** (`thegoodparty/omni`), cloned at `$PROJECT_ROOT/omni`. All apps and shared libs live under `omni/packages/`. One repo means unified deploys, shared context for agents, and de-duplicated cross-service code.

**Path convention**: when this doc references an app path like `gp-api/src/...`, the on-disk path is `$PROJECT_ROOT/omni/packages/gp-api/src/...`.

**Still separate repos** (not in omni): `gp-ai-projects`, `gp-data-platform`, `runbooks`, `ops` (Delegate agent framework), and `gp-marketing` (the public marketing site, which moved out of gp-webapp). The first three are cloned alongside omni at `$PROJECT_ROOT/`.

## Prerequisites

**books/.env variables**: `$PROJECT_ROOT`, `$AWS_REGION`, `$AWS_PROFILE`

**Identity**:
- **AWS Region**: `$AWS_REGION` | **AWS_PROFILE**: `$AWS_PROFILE` | Account ID: `aws sts get-caller-identity --query Account --output text`
- **GitHub Org**: `thegoodparty` | **Monorepo**: `thegoodparty/omni`
- **Domain**: `goodparty.org` (Route53 zone: `aws route53 list-hosted-zones --query 'HostedZones[].{Name:Name,Id:Id}' --output table`)

---

## Codebases

### omni packages (`$PROJECT_ROOT/omni/packages/`)

| Package | Stack | Local Port | Prod URL | Deploy |
|---------|-------|-----------|----------|--------|
| **gp-api** | NestJS 11/Fastify, Prisma, PG | 3000 | `api.goodparty.org` | Docker → ECR → Pulumi → ECS Fargate |
| **gp-webapp** | Next.js 15, React 19, Tailwind, MUI | 4000 | `goodparty.org` (product app) | Vercel (CLI) |
| **election-api** | NestJS/Fastify, Prisma, PG | 3001 | `election-api.goodparty.org` | Docker → ECR → Pulumi → ECS Fargate |
| **people-api** | NestJS/Fastify, Prisma, PG | 3002 | `people-api.goodparty.org` | Docker → ECR → Pulumi → ECS Fargate |
| **gp-admin** | Next.js 16, React 19 | 3500 | Vercel (single deploy fronts dev/qa/prod) | Vercel (CLI) |
| **candidate-sites** | Next.js, React, Tailwind | 4001 | Vercel | Vercel (CLI) |
| **gp-sdk** | TypeScript (`@goodparty_org/sdk`) | — | typed API client — in-tree, not published | — |
| **contracts** | TypeScript (`@goodparty_org/contracts`) | — | Zod schemas/types for cross-service shapes — in-tree, not published | — |

> `gp-sdk` and `contracts` carry scoped npm names but are **in-tree workspace packages**, consumed via `"*"` workspace deps + node_modules symlinks. A change is live the moment it builds — no version bump or publish. npm publishing is intentionally disabled in omni. Change a cross-boundary shape in the **same PR** as its producer and consumer.

### External repos (separate, not in omni)

| Project | Location | Stack | Purpose |
|---------|----------|-------|---------|
| **gp-ai-projects** | `$PROJECT_ROOT/gp-ai-projects` | Python/FastAPI, Gemini | AI/ML pipeline: campaign-plan generation, civic message analysis, HubSpot-DDHQ matching, engineer agent. ALBs: `ai-prod`, `ai-dev`, `ai-qa` |
| **gp-data-platform** | `$PROJECT_ROOT/gp-data-platform` | Airbyte + dbt + Databricks | Full data pipeline: ingest 9+ sources, transform with 460+ dbt models, write back to all PG databases |
| **runbooks** | `$PROJECT_ROOT/runbooks` | Markdown + scripts | Agent runbooks (this repo). PMF Engine experiment runs execute these via gp-api's `agentExperiments` dispatch |
| **gp-marketing** | `thegoodparty/gp-marketing` | Next.js | Public marketing site (moved out of gp-webapp) |
| **ops** | `thegoodparty/ops` | — | Operational scripts + Delegate agent/review framework |

---

## How Services Connect

```
Users → goodparty.org (Vercel: gp-webapp — product app for candidates & elected officials)
         ├── middleware proxies /api/v1/* to gp-api (injects JWT from cookies)
         ├── election data reaches the app via gp-api (proxied; no direct election-api calls)
         └── candidate-sites (Vercel) for candidate pages → calls gp-api

Staff → gp-admin (Vercel, single deploy) → gp-api via @goodparty_org/sdk + Clerk M2M
         (active Clerk org selects dev/qa/prod; per-env M2M secret, no cookie flow)

gp-api (53 controllers, 20+ Prisma models)
  ├── HTTP + S2S JWT → people-api
  │     POST /v1/people           (paginated voter list with filters)
  │     POST /v1/people/sample    (hash-bucketed random sampling)
  │     POST /v1/people/download  (cursor-based CSV streaming)
  │     GET  /v1/people/stats     (pre-computed district demographics)
  │     GET  /v1/people/:id       (single voter lookup)
  │
  ├── HTTP (no auth) → election-api
  │     GET /v1/positions/by-ballotready-id/:id  (gold flow: BR position → district → turnout)
  │     GET /v1/projectedTurnout                 (direct turnout lookup)
  │     GET /v1/districts/types                  (valid district types by state)
  │     GET /v1/districts/names                  (valid district names by type)
  │
  ├── HTTP → gp-ai-projects (external)           (AI campaign-plan generation)
  │
  ├── SQS (single FIFO queue, message types)
  │     GENERATE_AI_CONTENT      → AI content generation
  │     PATH_TO_VICTORY          → Win number calculations (3 retry max, gold/silver flows)
  │     TCR_COMPLIANCE_STATUS_CHECK → Peerly 10DLC verification
  │     DOMAIN_EMAIL_FORWARDING  → ForwardEmail domain setup
  │     POLL_CREATION            → Sample contacts + send CSV to Tevyn via Slack
  │     POLL_EXPANSION           → Expand poll audience (exclude already sent)
  │     POLL_ANALYSIS_COMPLETE   → Process poll results from gp-ai-projects
  │     experiment_run           → PMF Engine: dispatch a runbook to the agent worker
  │
  ├── vendor integrations (see External Integrations)
  └── Aurora PG: gp-api-db-prod (20+ models)

@goodparty_org/contracts (packages/contracts)
  └── Zod schemas/types for every cross-service shape (S2S payloads, SQS bodies,
      webhook bodies, shared API responses). gp-sdk is built on it; gp-admin consumes the SDK.

gp-ai-projects (external — uv workspace monorepo)
  ├── Campaign Plan API          (FastAPI, Gemini, Tavily web search)
  ├── Serve-Analyze Pipeline     (consolidate → cluster → SQS publish)
  ├── DDHQ Matcher               (HubSpot-DDHQ race matching)
  ├── Engineer Agent             (Claude via claude-agent-sdk, ClickUp-triggered)
  └── SQS → gp-api              (PollAnalysisCompleteEvent)

gp-data-platform (external — dbt + Databricks)
  ├── Airbyte → Databricks       (9 sources: HubSpot, BallotReady, Amplitude, Stripe, gp-api DB, DDHQ, TechSpeed, BallotReady S3, L2)
  ├── dbt transforms             (387 staging → 52 intermediate → 23 marts)
  └── 4 PySpark write models →   election-api PG, people-api PG, gp-api voter PG
```

### Auth Between Services

| From | To | Method | Details |
|------|----|--------|---------|
| Browser → gp-webapp | — | Cookie | `token` HTTP-only cookie (120-day expiry), `user` readable cookie |
| gp-webapp middleware → gp-api | JWT Bearer | Middleware intercepts `/api/v1/*`, injects `Authorization` header from cookie |
| gp-admin → gp-api | SDK + Clerk M2M | `@goodparty_org/sdk`, per-env Clerk M2M secret; active Clerk org selects env (no cookie flow) |
| gp-api → people-api | S2S JWT Bearer | Signed with `PEOPLE_API_S2S_SECRET`, 5-min TTL, cached, issuer: `gp-api` |
| gp-api → election-api | Clerk M2M | Mints `mt_*` token with `GP_WEBAPP_MACHINE_SECRET` (cached), sends `Authorization: Bearer` |
| gp-marketing → election-api | Clerk M2M | Server-only; mints `mt_*` token with `GP_MARKETING_MACHINE_SECRET` (cached), sends `Authorization: Bearer` |
| M2M caller → gp-api | Bearer `mt_*` token | `ClerkM2MAuthGuard` |
| gp-api guards | — | Three global guards in order: `ClerkM2MAuthGuard` → `SessionGuard` → `RolesGuard` |
| people-api | — | `S2SAuthGuard` (global), verifies JWT with shared secret, localhost bypass in dev |
| election-api | — | Global `M2MAuthGuard` (default-deny), verifies `mt_*` against `ELECTION_API_MACHINE_SECRET`; only `/v1/health` is `@PublicAccess`. Enforcement gated by `ELECTION_API_AUTH_ENFORCED` (observe-only until `true`) |
| Admin impersonation | — | `impersonateToken`/`impersonateUser` cookies override normal auth |

Guard detail and decorators: `gp-api/src/authentication/CLAUDE.md`.

### Frontend → Backend URL Config

| App | Config File | Env Vars |
|-----|------------|----------|
| gp-webapp | `gp-webapp/appEnv.ts` | `NEXT_PUBLIC_API_BASE` (per-PR override to `https://pr-<N>.preview.goodparty.org`), `NEXT_PUBLIC_OLD_API_BASE`. `NEXT_PUBLIC_ELECTION_API_BASE` is still defined (exported as `ELECTION_API_ROOT`) but currently has no consumers — election data is proxied through gp-api |
| gp-admin | per-env config + Clerk org | Talks to gp-api via the SDK; one Vercel deploy switches env by active Clerk org |
| candidate-sites | `candidate-sites/appEnv.ts` | `NEXT_PUBLIC_API_BASE` (default: `localhost:3000/v1`) |

---

## Service Deep Dives

### gp-api — Central Backend

**~53 API controllers** organized by domain:

| Domain | Routes | Purpose |
|--------|--------|---------|
| Campaigns | `/campaigns`, `/public-campaigns`, `/campaigns/:id/positions`, `/campaigns/tasks`, `/campaigns/mine/update-history`, `/campaigns/map` | Core campaign CRUD, positions, weekly tasks, history, map |
| AI | `/campaigns/ai/chat`, `/campaigns/ai` | AI chat assistant (thread management), AI content generation |
| Agent Experiments | `/agent-experiments` (PMF Engine) | Dispatches `experiment_run` to SQS; a Lambda/Fargate worker runs the matching runbook and returns results on the agent-results queue. See `gp-api/src/agentExperiments/CLAUDE.md` |
| Auth | `/authentication` | Login, social login (Google OAuth), JWT tokens |
| Users | `/users`, `/admin/users` | User management, admin user operations |
| Elections | `/elections` | Proxy to election-api for district/turnout data |
| Contacts | `/contacts` | Proxy to people-api for voter data (list, search, download, stats) |
| Path to Victory | `/path-to-victory` | Win number calculations — gold flow (BallotReady → election-api) + silver flow (LLM-based, via SQS) |
| Outreach | `/outreach`, `/contact-engagement`, `/scheduled-messaging` | Voter outreach campaigns, scheduled text messages |
| Polls | `/polls` | Constituency polling — create, expand, analyze, bias check |
| Websites | `/websites`, `/domains` | Campaign website builder, domain purchase (Vercel), email forwarding (ForwardEmail) |
| Payments | `/payments`, `/payments/purchase` | Stripe processing, pro upgrade |
| Voters | `/voters`, voter file routes | Voter file management, download access |
| CRM | `/crm` | HubSpot sync (users + campaigns) |
| Content | `/content` | Contentful CMS content |
| Compliance | `/campaigns/tcr-compliance` | 10DLC TCR compliance verification (Peerly) |
| P2P | `/p2p` | Peerly SMS/calling — identity, phone lists, media, P2P jobs |
| Annotations / Artifacts | `/annotations`, `/artifact-feedback`, `/artifact-review`, `/speech` | Newer modules backing admin/agent workflows |
| Other | `/health`, `/v1/version`, `/jobs`, `/queue`, `/error-logger`, `/subscribe`, `/declare`, `/ecanvasser`, `/top-issues`, `/positions`, `/community-issues`, `/elected-office` | Utilities, integrations. `GET /v1/version` returns `{ commit }` for deploy verification |

**Prisma schema** (modular `prisma/schema/*.prisma`, 20+ models): Campaign, User, PathToVictory, AiChat, Website, Domain, Poll, PollIssue, PollIndividualMessage, Outreach, ScheduledMessage, CampaignPosition, CampaignPlanVersion, CampaignUpdateHistory, TcrCompliance, VoterFileFilter, ElectedOffice, TopIssue, Position, CommunityIssue, Content, BlogArticleMeta, WebsiteContact, WebsiteView, CensusEntity, Ecanvasser. See `gp-api/prisma/CLAUDE.md`.

**Services**: Prisma-backed services extend `createPrismaBase(MODELS.ModelName)`.

**Vendor services** in `src/vendors/`: aws (S3, SQS), braintrust, contentful, ecanvasserIntegration, forwardEmail, google, peerly (5 sub-services), segment, slack, stripe, vercel

**Observability**: emits OpenTelemetry (OTLP) to Grafana Cloud. Dashboards + alert rules defined as code in `gp-api/deploy/components/grafana.ts` and `components/alerting/`.

### people-api — Voter Data Service

**Purpose**: Authenticated read-only access to 200M+ L2 voter records for gp-api. 6 API routes, all behind S2S JWT auth except health check.

**Prisma schema** (4 models, multi-schema PG: `green` + `public`):

| Model | Purpose | Scale |
|-------|---------|-------|
| `Voter` | L2 voter record — 159 fields covering demographics, addresses, voting history (2016-2026), phone numbers | 200M+ rows, 31 indexes |
| `District` | L2 districts — unique on `(type, name, state)` | Thousands |
| `DistrictVoter` | Many-to-many junction — composite PK `(districtId, voterId)` | Hundreds of millions |
| `DistrictStats` | Pre-computed per-district aggregates — total constituents, cell phone counts, demographic buckets | One per district |

**Performance patterns for 200M+ records**:
- All voter queries use **raw parameterized SQL** via `Prisma.sql` (not Prisma query builder)
- **Hash-bucketed sampling**: Uses `hashtextextended()` with seed-based bucket selection instead of `ORDER BY RANDOM()`
- **Cursor-based CSV streaming**: Keyset pagination (`WHERE id > $lastId`) in 5,000-row pages, streamed with backpressure handling via `@fast-csv/format`
- **Pre-computed counts**: `DistrictStats` avoids `COUNT(*)` on full Voter table
- **Connection pooling**: `connection_limit=25`, `pool_timeout=5`, `socket_timeout=60`
- **Filter system**: 15 filterable fields with value mapping (API-facing enums → L2 database values), supports `eq`, `in`, `gte`, `lte`, `range`, `or` operators
- **Search**: Phone normalization + FirstName/LastName matching
- **Force custom plan**: `SET LOCAL plan_cache_mode = force_custom_plan` prevents PG from caching bad generic plans

**Deploy**: Docker → ECR → Pulumi → ECS Fargate (`packages/people-api/deploy/`). Environments: `dev`/`prod` only (no qa). Aurora PG prod: `db.r6g.4xlarge` x2.

### election-api — Election Data Service

**Purpose**: Read-only API over BallotReady election data. All data written by gp-data-platform dbt models. Secured by default with Clerk M2M — every route except `GET /v1/health` requires a valid `mt_*` token (see Auth Between Services). Callers: gp-api and gp-marketing (both server-side).

**7 controllers**, all prefixed `/v1`:

| Route | Purpose |
|-------|---------|
| `GET /v1/positions/by-ballotready-id/:id` | Gold flow: BallotReady position → district → projected turnout |
| `GET /v1/projectedTurnout` | Direct turnout lookup by state + district + election date |
| `GET /v1/districts/list`, `/types`, `/names` | District queries with optional turnout join |
| `GET /v1/races` | Filter races by state, date range, position level, primary/runoff |
| `GET /v1/candidacies` | Filter candidacies by state, slug, race slug; include stances |
| `GET /v1/places` | Place hierarchy (counties → districts), children categorization |
| `GET /v1/places/most-elections` | Top N places by race count |

**Prisma schema** (8 models):

```
Place (self-ref parent/children, MTFCC-classified)
  └── Race (election date, position level, partisan type)
        └── Candidacy (name, party, slug)
              └── Stance → Issue (self-ref hierarchy)

District (state + L2 type/name, unique constraint)
  ├── ProjectedTurnout (per election year/code, model predictions)
  └── Position (BallotReady position ID → district link — key for gold flow)
```

**Election code logic**: `determineElectionCode(date, state)` classifies election dates — General (even year, first Tues after first Mon in Nov), ConsolidatedGeneral (LA/MS/NJ/VA odd years, KS 4-year cycle), everything else LocalOrMunicipal.

**Auth**: global `M2MAuthGuard` (`src/authentication/`) registered as `APP_GUARD` — default-deny, verifies Clerk M2M `mt_*` tokens against `ELECTION_API_MACHINE_SECRET`. Routes opt out with `@PublicAccess()` (only the health check). `ELECTION_API_AUTH_ENFORCED` toggles enforcement: while `!= 'true'` the guard runs in observe-only mode (verify + log, never reject) for safe rollout; set to `true` to start returning `401`. Swagger `/api` is only mounted outside production.

**Deploy**: Docker → ECR → Pulumi → ECS Fargate (`packages/election-api/deploy/`). Local port 3001. Aurora Serverless v2. Not part of the full-stack PR-preview pairing — gp-webapp doesn't call it directly (election data is proxied through gp-api), and there is no per-PR election-api stack; PR previews use the shared dev election-api.

### gp-ai-projects — AI Services (external repo)

**uv workspace monorepo** at `$PROJECT_ROOT/gp-ai-projects` with 5 packages + shared utilities. Python 3.11+. All LLM calls use **Gemini exclusively** (no OpenAI).

**Services**:

| Service | Runtime | Trigger | Purpose |
|---------|---------|---------|---------|
| **Campaign Plan API** | FastAPI | HTTP from gp-api | Generate 6-section campaign plans (overview, strategy, timeline, budget, community, voter contact). Gemini + Tavily web search. Returns PDF/JSON. |
| **Serve-Analyze (V1 Pipeline)** | ECS Fargate | Lambda trigger | Analyze constituent poll messages — consolidate → hierarchical clustering (embeddings, UMAP/PCA, HDBSCAN) → LLM ranking of top 3 clusters → publish `PollAnalysisCompleteEvent` to SQS |
| **DDHQ Matcher** | ECS Fargate | Lambda trigger | Match HubSpot contacts to DDHQ election results via Google Sheets |
| **Engineer Agent** | ECS Fargate | ClickUp webhook → Lambda | Autonomous coding agent using Claude via `claude-agent-sdk`. Clones repos, reads logs, queries Databricks, creates PRs. Modes: `gpbot-analyze`, `gpbot-work`. |
| **ClickUp Bot** | Lambda | Webhook | Listens for `taskTagUpdated`, triggers engineer agent ECS task |

**Campaign plan generation flow**:
1. Clean input data (city/state from jurisdiction, format dates)
2. Parallel generation via `asyncio.gather()`: Overview, Strategic Landscape, Budget, Know Your Community (Tavily searches), Voter Contact Plan
3. Sequential: Campaign Timeline (depends on community + voter contact)
4. Assembly: Header + 6 sections → PDF/JSON output
5. Cost tracking per section (LLM + Tavily)

**Deployment**: Containers share one ECR repo (`gp-ai-projects`) with different tags, all `linux/arm64` (Graviton). CI: GitHub Actions builds Docker → ECR. On-demand ECS clusters: `serve-analyze-{env}`, `ddhq-matcher-{env}`, `engineer-agent-{env}`.

### gp-webapp — Product Frontend

**Next.js 15 App Router**. This is the **product app** for candidates & elected officials — the public marketing site moved to the external `gp-marketing` repo, so marketing/landing/company/blog pages are no longer here.

Route groups under `gp-webapp/app/`: `dashboard`, `onboarding`, `login`/`logout`/`sign-up`, `polls`, `impersonate`, `post-auth-redirect`, `api`, plus a thin legacy `admin` (most admin work now lives in the dedicated **gp-admin** package).

**API client architecture** (3-tier fetch):
- `clientFetch.ts` — Client components: builds URLs, adds Bearer token, `credentials: include`
- `serverFetch.ts` — Server components: reads JWT from cookies via `next/headers`
- `unAuthFetch.ts` — Public endpoints: GET-only with ISR revalidation
- **Middleware proxy**: Client-side requests go to `/api/v1/*` (same origin), middleware rewrites to `API_ROOT` with injected auth header — browser never sees cross-origin requests

**State management**: React Context providers + TanStack React Query. Feature flags via Amplitude Experiment.

**Types**: gp-webapp keeps some hand-rolled types in `gp-webapp/gpApi` + `helpers/types.ts`; prefer `@goodparty_org/contracts` for new cross-service shapes.

**Key dependencies**: React 19, TanStack React Query, react-hook-form, Recharts + Chart.js, Quill (rich text), Stripe.js, Google Maps, Google OAuth, Segment analytics, Sentry browser SDK, Playwright (e2e), Vitest (unit)

### gp-admin — Internal Staff Console (new)

**Next.js 16 App Router** at `packages/gp-admin` (`src/app`, `components`, `lib`, `shared`, `middleware.ts`). Local port 3500.

- Talks to gp-api exclusively via `@goodparty_org/sdk`, authenticated with a per-environment **Clerk M2M secret** (no user cookie flow).
- A **single Vercel deploy** fronts dev/qa/prod — the active Clerk org selects which environment it targets.
- Replaces the legacy admin tooling that used to live inside gp-webapp.

### candidate-sites — Candidate Campaign Websites

**Purpose**: Renders public single-page campaign websites for GoodParty candidates. Dynamic route `[vanityPath]` fetches website data from gp-api.

**Sections**: HeroSection (photo, title, tagline) → AboutSection (bio, issues) → ContactSection (form) → Footer (committee, privacy)

**Features**: Themeable (light/dark/custom via `content.theme`), view tracking analytics, ISR revalidation. Connects to gp-api via `fetchHelper` → `${API_ROOT}/websites/{vanityPath}/view`.

---

## Candidate Signup & Onboarding Flow

### Overview

New candidates go through: **Signup → Campaign Creation → 4-Step Onboarding → Launch → Dashboard**. The campaign's `isActive` flag is the single gate that determines whether a user sees "Dashboard" or "Continue Onboarding" in the nav.

### Flow

```
1. Signup (/sign-up)
   └── User creates account (email/password or Google OAuth)
   └── POST /authentication/register → creates User record

2. Post-Auth Redirect (doPostAuthRedirect in ajaxActions.ts)
   └── POST /campaigns/create → creates Campaign with:
       isActive: false, data.currentStep: "registration", details: { zip }
   └── If currentStep = "onboarding-complete" → /dashboard
   └── Otherwise → /onboarding/{slug}/{step+1}

3. Onboarding Steps (/onboarding/[slug]/[step])
   Step 1 — OfficeStep: Select office/race (sets details.office, details.partisanType, etc.)
   Step 2 — PartyStep: Select party affiliation (sets details.party or details.otherParty)
   Step 3 — PledgeStep: Accept user agreement (sets details.pledged = true)
   Step 4 — CompleteStep: Click "View Dashboard" → calls:
       a. updateCampaign({ data.currentStep: "onboarding-complete" })
       b. POST /campaigns/launch → sets isActive=true, launchStatus="launched"
       c. window.location.href = '/dashboard'

4. Dashboard Access
   └── candidateAccess() checks user exists (no campaign status check)
   └── Nav shows "Dashboard" or "Continue Onboarding" based on CampaignStatusProvider
```

### Campaign Status Determination

**Backend** (`gp-api/src/campaigns/services/campaigns.service.ts`):

```
getStatus(campaign):
  if campaign.isActive → return { status: "candidate" }    ← DASHBOARD
  else:
    step = 1
    if details.office → step = 2
    if details.party OR details.otherParty → step = 3
    if details.pledged → step = 4
    return { status: "onboarding", step }                  ← CONTINUE ONBOARDING
```

**Frontend** (`CampaignStatusProvider.tsx`): Fetches status via `fetchCampaignStatus()` (client-side), stores in React Context. Nav components read from context:
- `DashboardOrContinue.tsx` (desktop): `status === 'candidate'` → Dashboard, else → Continue Onboarding
- `RightSideMobile.tsx` (mobile): same logic

### Key Files

| File (under `omni/packages/`) | Purpose |
|------|---------|
| `gp-api/src/campaigns/services/campaigns.service.ts` | `createForUser()` (initial creation), `getStatus()` (status + step), `launch()` (sets isActive=true) |
| `gp-api/src/campaigns/campaigns.types.ts` | `CampaignStatus`, `CampaignLaunchStatus`, `OnboardingStep` enums |
| `gp-webapp/app/onboarding/[slug]/[step]/components/` | Step components: OfficeStep, PartyStep, PledgeStep, CompleteStep |
| `gp-webapp/app/onboarding/shared/ajaxActions.ts` | `doPostAuthRedirect()`, `updateCampaign()`, `onboardingStep()` |
| `gp-webapp/helpers/fetchCampaignStatus.ts` | Client-side status fetch |
| `gp-webapp/app/shared/user/CampaignStatusProvider.tsx` | React Context provider for campaign status |
| `gp-webapp/app/shared/layouts/navigation/DashboardOrContinue.tsx` | Desktop nav: Dashboard vs Continue Onboarding |
| `gp-webapp/app/shared/layouts/navigation/RightSideMobile.tsx` | Mobile nav: same logic |

### Known Issue: "Stuck on Continue Onboarding"

Candidates can end up with `isActive=false` permanently if the `launch()` function is never called (step 4 never completed). The `getStatus()` step calculation infers progress from `details` field presence — if intermediate fields like `party` or `pledged` aren't set, the user appears stuck at an earlier step even if they progressed further through a different path (e.g. paid for Pro, got P2V completed).

**Manual fix** (run against prod DB):
```sql
UPDATE campaign SET
  is_active = true,
  data = jsonb_set(jsonb_set(data, '{currentStep}', '"onboarding-complete"'), '{launchStatus}', '"launched"')
WHERE id = <campaign_id>;
```

**Detection query** (find stuck campaigns — Pro users with office set but never launched; does not cover all stuck patterns):
```sql
SELECT c.id, u.email, c.data->>'currentStep', c.details->>'office', c.details->>'party', c.details->>'pledged'
FROM campaign c JOIN "user" u ON c.user_id = u.id
WHERE c.is_active = false AND c.is_pro = true
  AND c.details->>'office' IS NOT NULL;
```

---

## Path to Victory — Gold & Silver Flows

The "Path to Victory" (P2V) is the system that determines a candidate's win number (votes needed to win) and voter contact goals.

### P2V Data Lineage (dbt → election-api → gp-api)

The data that powers P2V flows through three dbt layers (in the external `gp-data-platform` repo) before reaching the election-api database:

**Databricks source tables** (schema: `model_predictions`):

| Source Table | Purpose | Key Columns |
|---|---|---|
| `llm_l2_br_match_20260126` | Gemini LLM output: matches L2 voter districts to BallotReady positions/offices | `br_database_id`, `state`, `l2_district_type`, `l2_district_name`, `is_matched`, `confidence`, `embeddings`, `top_embedding_score`, `llm_reason` |
| `turnout_projections_even_years_20250709` | ML model: projected voter turnout for even-year elections | `state`, `district_type`, `district_name`, `election_year`, `election_code`, `ballots_projected`, `model_version`, `inference_at` |
| `turnout_projections_model2odd` | ML model: projected voter turnout for odd-year elections | Same columns as even years (aliased: `office_type` → `district_type`, `office_name` → `district_name`) |

**dbt staging** (`stg_model_predictions__*`): Thin wrappers, column renames, pass-through.

**dbt intermediate**:

| Model | Purpose | Logic |
|---|---|---|
| `int__enhanced_position` | Enriches BallotReady positions with fast facts (population, density, income, etc.) | Joins `stg_airbyte_source__ballotready_api_position` with `int__position_fast_facts`. Generates salted UUID as `id`. |
| `int__model_prediction_voter_turnout` | Unions even-year + odd-year turnout projections | Deduplicates by (state, district_type, district_name, election_year, election_code, model_version), keeps latest `inference_at`. |

**dbt marts** (election_api): These 3 models produce the tables written to election-api PG:

| Mart Model | → PG Table | Logic |
|---|---|---|
| `m_election_api__district` | `District` | Unions 3 district sources: (1) turnout projection districts, (2) L2 voter data districts (unpivoted from 200+ L2 district columns), (3) state-level districts for statewide positions. UUID generated from `(state, l2_district_type, l2_district_name)`. |
| `m_election_api__projected_turnout` | `Projected_Turnout` | Joins `int__model_prediction_voter_turnout` to districts via salted UUID. Maps election codes (`Local_or_Municipal` → `LocalOrMunicipal`, `Consolidated_General` → `ConsolidatedGeneral`). UUID from `(district_id, election_year, election_code, model_version)`. |
| `m_election_api__position` | `Position` | **This is the gold flow link.** Joins `stg_model_predictions__llm_l2_br_match_20260126` (Gemini LLM matches) → `int__enhanced_position` (BallotReady positions) → `m_election_api__district` (L2 districts). Filters: `confidence >= 95` for state-level, `>= 90` for sub-state. Only keeps rows where `district_id IS NOT NULL`. |

Other election-api marts: `m_election_api__place`, `m_election_api__race`, `m_election_api__candidacy`, `m_election_api__stance`, `m_election_api__issue` (BallotReady data for public election directory).

**Write model**: `write__election_api_db.py` (PySpark) writes all 8 tables to election-api PG via JDBC in FK-safe order.

### Gold Flow (preferred, higher confidence)

1. Campaign onboarding captures a BallotReady position ID
2. gp-api calls `election-api GET /v1/positions/by-ballotready-id/:brPositionId` with `includeDistrict=true&includeTurnout=true`
3. election-api resolves the chain: `Position` (matched by Gemini LLM, confidence >= 90/95%) → `District` (L2 district type/name) → `ProjectedTurnout` (ML model prediction, filtered by election year + code)
4. gp-api calculates: `winNumber = ceil(projectedTurnout * 0.5) + 1`, `voterContactGoal = winNumber * 5`
5. If turnout unavailable, returns sentinel values (-1) — partial match, district known but turnout not predicted
6. The matched `district.L2DistrictType` and `district.L2DistrictName` are stored in the campaign's `PathToVictory` record — these are the same keys used by people-api to scope voter contacts

### Silver Flow (fallback, via SQS)

1. Gold flow fails or has no turnout data
2. gp-api enqueues `PATH_TO_VICTORY` message to SQS
3. Queue consumer calls `pathToVictoryService.handlePathToVictory()` (LLM-based matching)
4. On failure: retries up to 3 times. After 3 failures, marks P2V as failed (unless gold flow already set `districtMatched` or `complete`)
5. Failures reported to Slack `#botPathToVictoryIssues`

---

## P2P & Outreach — End to End

The P2P (peer-to-peer) texting system allows candidates to send SMS outreach to voters through the Peerly platform. It involves three prerequisite phases (TCR compliance, phone list creation, outreach creation) before texts can be sent.

### Peerly API Services (gp-api `src/vendors/peerly/`)

5 sub-services, all inheriting `PeerlyBaseConfig` (env: `PEERLY_API_BASE_URL`, `PEERLY_MD5_EMAIL`, `PEERLY_MD5_PASSWORD`, `PEERLY_ACCOUNT_NUMBER`, `PEERLY_SCHEDULE_ID`):

| Service | Purpose | Key Peerly API Endpoints |
|---------|---------|--------------------------|
| `PeerlyAuthenticationService` | JWT auth with auto-renewal (5-min threshold) | `POST /token-auth` |
| `PeerlyIdentityService` | TCR/10DLC identity management, brand submission, Campaign Verify | `POST /identities`, `GET /identities/listByAccount`, `POST /v2/tdlc/{id}/submit`, `POST /v2/tdlc/{id}/approve`, `POST /v2/tdlc/{id}/submit_cv`, `POST /v2/tdlc/{id}/verify_pin` |
| `PeerlyPhoneListService` | Upload voter CSV phone lists, check processing status | `POST /phonelists`, `GET /phonelists/{token}/checkstatus`, `GET /phonelists/{listId}` |
| `PeerlyP2pJobService` | Orchestrates job creation (media → job → assign list). Jobs are created in Paused state for CaS team review. | `POST /1to1/jobs`, `POST /1to1/jobs/{id}/assignlist`, `GET /1to1/jobs` |
| `PeerlyMediaService` | Upload MMS images (JPEG/PNG/GIF, max 500KB) | `POST /v2/media` |

### Phase 1: TCR 10DLC Compliance Registration

Before a campaign can send P2P texts, it must complete 10DLC (10-digit long code) registration through Peerly's TCR (The Campaign Registry) flow.

**Controller**: `POST /campaigns/tcr-compliance` → `CampaignTcrComplianceService.create()`

**5-step registration flow** (all in one request):
1. **Create Peerly Identity** — `POST /identities` with identity name `"{userName} - {EIN}"` (prefixed `TEST-` in non-prod). Skips if identity already exists.
2. **Submit Identity Profile** — `POST /identities/{id}/submitProfile` with `entityType: NON_PROFIT`, `is_political: true`. Skips if profile exists.
3. **Submit 10DLC Brand** — `POST /v2/tdlc/{id}/submit` with committee name, EIN, phone, address (Google Places → formatted), website domain, and job areas (state + area codes from zip). Only submits if identity profile doesn't have `vertical` set yet.
4. **Submit Campaign Verify Request** — `POST /v2/tdlc/{id}/submit_cv` with committee type, EIN, filing URL, election date, address, locality (federal/state/local mapped from `OfficeLevel`). Federal requires `fec_committee_id`.
5. **Create TcrCompliance DB record** — Stores `peerlyIdentityId`, `peerly10DLCBrandSubmissionKey`, `peerlyIdentityProfileLink`, plus all input data.

**Campaign Verify PIN flow** (separate endpoint):
- `POST /campaigns/tcr-compliance/:id/submit-cv-pin` → verifies PIN with Peerly → creates Campaign Verify token → approves 10DLC brand with sample SMS messages → updates status to `pending`

**Async status polling** (every 12 hours by default):
- `CampaignTcrComplianceService.bootstrapTcrComplianceCheck()` — finds all `pending` TCR records, enqueues `TCR_COMPLIANCE_STATUS_CHECK` messages to SQS
- Queue consumer checks Peerly use case activation + Campaign Verify status
- Once activated: updates TcrCompliance status to `approved`, tracks `ComplianceCompleted` analytics event, identifies user as `10DLC_compliant`

**Peerly error reporting**: All Peerly API failures in the identity service are reported to Slack `#bot10DlcCompliance` with user info, request config, and error details.

### Phase 2: Phone List Upload

**Controller**: `POST /p2p/phone-list` → `P2pPhoneListUploadService.uploadPhoneList()`

**Flow**:
1. Validate TCR compliance exists with `peerlyIdentityId`
2. Transform audience filters (voter propensity, party, age, gender) to `CustomFilter[]`
3. Query voter DB for matching voters → generate CSV stream with `CHANNELS.TEXTING` + `PURPOSES.GOTV`
   - Connects to `VOTER_DATASTORE` (people-api's voter PG) using raw `pg` Pool
   - Uses `COPY ... TO STDOUT WITH CSV HEADER` for streaming performance
   - Column mapping: `first_name` (1), `last_name` (2), `lead_phone` (3), `state` (4), `city` (5), `zip` (6)
4. Upload CSV buffer to Peerly via `POST /phonelists` with FormData (list name, identity ID, DNC scrubbing settings, phone list mapping, suppress landline phones)
5. Return upload `token` for status polling

**Status check**: `GET /p2p/phone-list/:token/status` — polls Peerly until `list_state === ACTIVE`, then returns `phoneListId` + `leadsLoaded` count

### Phase 3: Outreach Campaign Creation (P2P Type)

**Controller**: `POST /outreach` → `OutreachService.create()` → `createP2pOutreach()`

**Flow**:
1. Validate request: requires `campaignId`, `outreachType: p2p`, `script`, `phoneListId`, image file (JPEG/PNG/GIF)
2. Upload image to S3 (`scheduled-campaign/{slug}/p2p/{date}`)
3. Resolve TCR compliance `peerlyIdentityId`
4. Resolve job geography: campaign `placeId` → Google Places API → state + area codes from zip. Fallback: `campaign.details.state` + `details.zip` → zipcodes lookup. Default: `DID_STATE: 'USA'`
5. Resolve script content: replace AI content keys (`aiContent[key]`) with actual text
6. Call `PeerlyP2pJobService.createPeerlyP2pJob()`:
   a. **Upload media** — `POST /v2/media` (image → `media_id`)
   b. **Create job** — `POST /1to1/jobs` with template (script + media), DID state, schedule ID, identity ID
   c. **Assign phone list** — `POST /1to1/jobs/{jobId}/assignlist`
7. Create `Outreach` DB record with `projectId = jobId`, `status: pending` (job is created in Paused state on Peerly for CaS team review)

### Phase 4: Schedule & Notify (Legacy Text Flow)

**Controller**: `POST /voter-file/schedule` → `VoterOutreachService.scheduleOutreachCampaign()`

**Flow**:
1. Convert `VoterFileFilter` to audience display format
2. Build voter file download URL with encoded audience filters
3. Send Slack notification to `#botPolitics` (prod) / `#botDev` (non-prod) with: candidate name, PA assignment, voter file link, script, image, audience filters, Peerly job URL
4. Increment `campaign.data.textCampaignCount`, sync to HubSpot
5. Send "Texting Campaign Scheduled" email to user

### Outreach Purchase (Stripe Integration)

`OutreachPurchaseHandlerService` implements `PurchaseHandler<OutreachPurchaseMetadata>`:
- **Pricing**: `contactCount * pricePerContact`
- **Free texts offer**: P2P campaigns can get first 5,000 texts free (via `FREE_TEXTS_OFFER.COUNT`). Checks `campaignsService.checkFreeTextsEligibility()`.
- **Post-purchase**: Redeems free texts offer after successful payment

### Frontend (gp-webapp)

| Route | Components |
|-------|-----------|
| `/dashboard/outreach` | `OutreachPage` — create/list outreach campaigns. `OutreachCreateCards` (text + P2P options), `OutreachTable` (campaign list with P2P job status from Peerly), `FreeTextsBanner`, `OutreachContext` provider |
| `/dashboard/voter-records` | `VoterRecordsPage` — voter file types, custom audience builder. `/[type]` — detail page with download, schedule, script card |
| `/profile/texting-compliance` | TCR compliance form |

### Key Database Models

| Model | Table | Key Fields |
|-------|-------|-----------|
| `TcrCompliance` | `tcr_compliance` | `campaignId` (unique), `peerlyIdentityId`, `status` (pending/approved), `ein`, `committeeName`, `email`, `filingUrl`, `officeLevel` (federal/state/local), `committeeType`, `fecCommitteeId`, `peerly10DLCBrandSubmissionKey`, `peerlyIdentityProfileLink` |
| `Outreach` | `outreach` | `campaignId`, `outreachType` (text/p2p), `status`, `projectId` (Peerly job ID), `script`, `imageUrl`, `date`, `phoneListId`, `didState`, `didNpaSubset`, `voterFileFilterId` |
| `VoterFileFilter` | `voter_file_filter` | `campaignId`, audience filter fields (voter propensity, party, age, gender) |
| `ScheduledMessage` | `scheduled_message` | `campaignId`, `messageConfig` (JSON: type + message template), `scheduledAt`, `processing`, `sentAt`, `error` |

### Scheduled Messaging

`ScheduledMessagingService` (separate from P2P) — polls every hour (configurable via `SCHEDULED_MESSAGING_INTERVAL_SECS`), finds unsent messages where `scheduledAt <= now`, flags as `processing`, sends via `EmailService` (template or raw), updates `sentAt` or `error`. Only supports EMAIL type currently.

---

## Polling System — End to End

1. **Create poll**: gp-webapp → gp-api `POST /polls` → enqueues `POLL_CREATION` to SQS
2. **Sample voters**: Queue consumer calls people-api `POST /v1/people/sample` (hash-bucketed random sampling)
3. **Build CSV**: Generates CSV (id, firstName, lastName, cellPhone), uploads to S3 (`tevyn-poll-csvs-{stage}`)
4. **Send to Tevyn**: Posts CSV + poll message to Slack channel for Tevyn (SMS delivery service)
5. **Expand poll** (optional): `POLL_EXPANSION` message — samples more contacts, excludes already-sent
6. **Analyze results**: gp-ai-projects V1 pipeline runs (triggered by Lambda) — downloads response data from S3, clusters messages via hierarchical discovery + Gemini LLM, ranks top 3 clusters
7. **Publish results**: V1 pipeline publishes `POLL_ANALYSIS_COMPLETE` event to SQS with top issues
8. **Store results**: gp-api queue consumer creates `PollIssue` records, marks poll complete, determines confidence (HIGH if 75+ responses or >= 10% of constituency)

---

## Data Platform Pipeline (gp-data-platform — external repo)

### Airbyte Sources → Databricks

HubSpot, BallotReady, Amplitude, Stripe, gp-api PG, DDHQ (Google Drive), TechSpeed (Google Drive), BallotReady S3 dumps, L2 SFTP → S3

### dbt Model Layers

| Layer | Location | Count | Materialization |
|-------|----------|-------|----------------|
| Staging | `dbt/project/models/staging/` | 387 | Views — organized by source: airbyte_source (amplitude, ballotready, ddhq, gp_api_db, hubspot, stripe, techspeed), dbt_source/l2, historical, model_predictions |
| Intermediate | `dbt/project/models/intermediate/` | 52 | Views — ballotready, ballotready_to_hubspot, ddhq, general, gp_ai, l2, techspeed_to_hubspot |
| Marts | `dbt/project/models/marts/` | 23 | Tables (Liquid Clustering) — election_api (8), general (9), people_api (3), ballotready_internal (2), techspeed (1) |
| Load | `dbt/project/models/load/` | 3 | PySpark: L2 SFTP→S3, L2 S3→Databricks |
| Write | `dbt/project/models/write/` | 4 | PySpark, JDBC to PG — see below |

### dbt Write Models — What They Write

| Model | Target DB | Tables Written | Logic |
|-------|-----------|---------------|-------|
| `write__election_api_db` | election-api PG | Place, Race, Candidacy, Issue, Stance, District, Position, Projected_Turnout | FK-safe order. Incremental by `updated_at`. Filters races to 1 day past → 2 years future. Cleans old races + orphaned candidacies. |
| `write__people_api_db` | people-api PG | Voter, District, DistrictVoter | State-by-state ascending by row count. Incremental by `updated_at`. Non-prod downsampled to 6 small states (WY, ND, VT, DC, AK, SD). ~375 voter columns. |
| `write__l2_databricks_to_gp_api` | gp-api voter DB (`gp-voter-db`) | `Voter{STATE}` (per-state tables) | Checks `VoterFile` log to skip loaded files. Per-state staging → upsert on `LALVOTERID`. ~365 columns. |
| `write__l2_databricks_to_people_api` | people-api PG | Voter | Similar to write__people_api_db, different upsert strategy. Non-prod: WY, ND, VT only. 2-second buffer for microsecond rounding. |

### District → Voter Mapping Pipeline

L2 voter records in Databricks have 200+ district columns (`City_Ward`, `County`, `State_House_District`, `Unified_School_District`, etc.) — each voter has values for the districts they belong to.

**dbt flow**:
1. `m_people_api__district` — unpivots L2 district columns into distinct District records (type + name + state). UUID generated from `(state, type, name)`.
2. `m_people_api__districtvoter` — creates junction rows linking each voter to their districts based on the L2 column values.
3. `m_people_api__districtstats` — pre-computes per-district aggregates (total constituents, cell phone counts, demographic buckets) to avoid `COUNT(*)` on 200M+ rows.
4. `write__people_api_db` — writes all three tables to people-api PG, state-by-state.

**How the app uses districts**:
- **P2V gold flow** sets `L2DistrictType` + `L2DistrictName` on the campaign's PathToVictory record (e.g., `City_Ward` / `OVERLAND CITY WARD 1`)
- **Contacts** (people-api `POST /v1/people`) filters voters by district via DistrictVoter joins
- **Polls** sample voters from the district via `POST /v1/people/sample`
- **Outreach/P2P** builds phone lists from voters in the district
- **DistrictStats** powers the contacts stats endpoint (`GET /v1/people/stats`) without scanning the full Voter table

**Sync gap**: District records can be created by newer dbt mart builds independently of the DistrictVoter write. If new districts appear after the last `write__people_api_db` run for a state, those districts will exist with zero voters until re-run. Diagnose by comparing `District.created_at` vs `MAX(DistrictVoter.created_at)` for the state.

### Databricks

Catalog: `goodparty_data_catalog`. Read-only from app code (SELECT only). Write operations only through dbt.

---

## Secrets & Config Reference

### AWS Secrets Manager

| Secret Name | Used By |
|-------------|---------|
| `GP_API_DEV` | gp-api (dev + PR previews) |
| `GP_API_QA` | gp-api (qa) |
| `GP_API_PROD` | gp-api (prod) |
| `ELECTION_API_DEV` | election-api (dev + qa) |
| `ELECTION_API_PROD` | election-api (prod) |
| `PEOPLE_API_DEV` | people-api (dev) |
| `PEOPLE_API_PROD` | people-api (prod) |
| `AI_SECRETS_DEV` | gp-ai-projects (dev) |
| `AI_SECRETS_QA` | gp-ai-projects (qa) |
| `AI_SECRETS_PROD` | gp-ai-projects (prod) |

Read a secret: `AWS_PROFILE=$AWS_PROFILE aws secretsmanager get-secret-value --secret-id SECRET_NAME --query SecretString --output text | jq .`

### Local .env Files

In the monorepo, each app keeps its own local env files — copy from each app's `.env.example` / `.env.local` template before starting it.

| Package | .env Location | Notes |
|---------|--------------|-------|
| gp-api | `omni/packages/gp-api/.env` | DB, AWS, Stripe, HubSpot, Slack, Peerly, Vercel, Clerk, etc. |
| gp-webapp | `omni/packages/gp-webapp/.env.local` | `NEXT_PUBLIC_*`, Sentry |
| election-api | `omni/packages/election-api/.env` | DATABASE_URL, CORS_ORIGIN, LOG_LEVEL |
| people-api | `omni/packages/people-api/.env` | DATABASE_URL, PEOPLE_API_S2S_SECRET |
| gp-admin | `omni/packages/gp-admin/.env.local` | Clerk M2M, SDK base URL |
| candidate-sites | `omni/packages/candidate-sites/.env.local` | `NEXT_PUBLIC_API_BASE` |
| gp-ai-projects | `gp-ai-projects/.env` (external repo) | GEMINI_API_KEY, TAVILY_API_KEY, DATABRICKS_*, BRAINTRUST_API_KEY |
| gp-data-platform | `gp-data-platform/.env.example` (external repo) | DBT_CLOUD_PROJECT_ID |

Tests load `.env.test`.

### Key Env Vars by Service (names only)

**gp-api**: DATABASE_URL, PEOPLE_API_URL, PEOPLE_API_S2S_SECRET, ELECTION_API_URL, AUTH_SECRET, CONTENTFUL_SPACE_ID, CONTENTFUL_ACCESS_TOKEN, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, SQS_QUEUE, HUBSPOT_TOKEN, MAILGUN_API_KEY, STRIPE_SECRET_KEY, L2_DATA_KEY, BALLOT_READY_KEY, SLACK_BOT_*_TOKEN, VERCEL_TOKEN, VERCEL_PROJECT_ID, VERCEL_TEAM_ID, PEERLY_*, CLERK_SECRET_KEY, GP_WEBAPP_MACHINE_SECRET, BRAINTRUST_API_KEY

**people-api**: DATABASE_URL, PEOPLE_API_S2S_SECRET

**election-api**: DATABASE_URL, CORS_ORIGIN

**gp-ai-projects**: GEMINI_API_KEY, TAVILY_API_KEY, DATABRICKS_API_KEY, DATABRICKS_SERVER_HOSTNAME, DATABRICKS_HTTP_PATH, GOODPARTY_API_TOKEN, BRAINTRUST_API_KEY, ANTHROPIC_API_KEY, CLICKUP_API_KEY

**gp-admin**: CLERK_SECRET_KEY, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, per-env Clerk org IDs (GP_ORG_ID_DEV/QA/PROD) + M2M secrets (GP_DEV/QA/PROD_MACHINE_SECRET), GP_DEV/QA/PROD_API_DOMAIN, GP_API_PROTOCOL, GP_API_PORT, GP_API_ROOT_PATH, NEXT_PUBLIC_GP_WEBAPP_URL (see `omni/packages/gp-admin/.env.example`)

**Local agent tooling**: `GRAFANA_SERVICE_ACCOUNT_TOKEN` (for the Grafana MCP — see MCP tools below)

---

## AWS Infrastructure

All backend infra (gp-api, election-api, people-api) is now provisioned via **Pulumi** from `omni/packages/<app>/deploy/`. Images build on GitHub Actions runners and push to ECR (CodeBuild is no longer used).

### ECS Clusters & Services

| Cluster | Service | Tasks (prod) |
|---------|---------|-------------|
| `gp-master-fargateCluster` | `gp-api-master` | 2 |
| `gp-develop-fargateCluster` | `gp-api-develop` | — |
| `gp-qa-fargateCluster` | `gp-api-qa` | — |
| `gp-pr-*-fargateCluster` | `gp-api-pr-*` (ephemeral PR previews) | 1 each |
| `election-api-master-fargateCluster` | `election-api-master` | 2 |
| `election-api-develop-fargateCluster` | `election-api-develop` | 1 |
| `election-api-qa-fargateCluster` | `election-api-qa` | — |
| `people-api-master-fargateCluster` | `people-api-master` | 2-16 (auto-scale 50% CPU/mem) |
| `people-api-develop-fargateCluster` | `people-api-develop` | 1-4 |
| `vpn-cluster` | `vpn-service` | 1 |

On-demand ECS (Lambda-triggered, gp-ai-projects): `serve-analyze-{dev,qa,prod}`, `ddhq-matcher-{dev,qa,prod}`, `engineer-agent-{dev,qa,prod}`

> PR-preview clusters/DBs are ephemeral — enumerate live ones with `aws ecs list-clusters` rather than trusting a static list. Stale gp-api preview stacks are cleaned up by `gp-api-cleanup-preview.yml`.

### RDS Aurora PostgreSQL Clusters

| Cluster | Used By | Instance Class |
|---------|---------|---------------|
| `gp-api-db-prod` | gp-api prod | db.serverless |
| `gp-api-db` | gp-api dev | db.serverless |
| `gp-api-db-qa` | gp-api qa | db.serverless |
| `gp-api-pr-*` | PR previews (ephemeral) | db.serverless |
| `election-api-db-prod` | election-api prod | Serverless v2 (1-64 ACU, 14-day backup) |
| `election-api-db-develop` | election-api dev/qa | Serverless v2 (0.5-64 ACU, 7-day backup) |
| `gp-people-db-prod` | people-api prod | db.r6g.4xlarge (x2), Performance Insights advanced |
| `gp-people-db-dev` | people-api dev | db.t4g.medium |
| `gp-voter-db` | Voter data (L2) — per-state tables | db.r6g.4xlarge (x2) |
| `gp-voter-db-develop` | Voter data dev | db.serverless |

### S3 Buckets (key ones)

| Bucket | Purpose |
|--------|---------|
| `assets.goodparty.org` | Production assets (fronted by CloudFront) |
| `assets-dev.goodparty.org` | Dev assets (fronted by CloudFront) |
| `assets-qa.goodparty.org` | QA assets (fronted by CloudFront) |
| `normalized-voter-files` | L2 voter data by state |
| `goodparty-ballotready` | BallotReady election data |
| `goodparty-warehouse-databricks` | Databricks warehouse data |
| `tevyn-poll-csvs-{stage}` | Poll CSV data per environment |
| `serve-analyze-data-{env}` | Serve-analyze pipeline data |
| `ddhq-matcher-output-{env}` | DDHQ matcher results |
| `goodparty-terraform-state-$AWS_REGION` | Terraform state (gp-ai-projects) |
| `goodparty-iac-state` | IaC state |

```bash
# Look up CloudFront distributions
aws cloudfront list-distributions --query 'DistributionList.Items[].{Id:Id,Domain:DomainName,Origins:Origins.Items[0].DomainName}' --output table

# Look up S3 buckets
aws s3 ls | grep -i assets
```

### SQS (FIFO queues)

Per-stage: `{stage}-campaign-queue.fifo` + DLQ for develop, master, qa, PR previews. Per-developer: `{DevName}-campaign-queue.fifo` + DLQ (one per team member). Plus agent-experiment / agent-results queues for the PMF Engine.

### Lambda Functions

| Function | Purpose |
|----------|---------|
| `serve-analyze-trigger-{dev,qa,prod}` | Trigger serve-analyze ECS tasks |
| `ddhq-matcher-trigger-{dev,qa,prod}` | Trigger DDHQ matcher ECS tasks |
| `clickup-bot-prod` | ClickUp webhook → engineer agent ECS trigger |
| `shared-slack-notifier` | Slack notifications for deploys |
| `databricks-s3-ingest` (x2) | S3 → Databricks ingestion |
| `s3-ballotready` | BallotReady S3 processing |
| agent-experiment worker | PMF Engine: runs the matching runbook for an `experiment_run` |

### ECR Repositories

`gp-api`, `election-api`, `people-api`, `gp-ai-projects` (shared by serve-analyze, ddhq-matcher, engineer-agent with different tags), `vpn-repo`. ECR tags are **immutable** (keyed to commit SHA) — re-running a deploy job skips build/push if the tag already exists.

### Route53 Hosted Zones

`goodparty.org`, `thegoodparty.org` (legacy), `rf.goodparty.org`

### SNS Topics (failure alerts)

`ddhq-matcher-failures-{dev,qa,prod}`, `serve-analyze-pipeline-failures-{dev,qa,prod}`, `engineer-agent-failures-{dev,qa,prod}`, `GP-Prod-SNS`

### DynamoDB

`master-poll-insights-740c043` (poll insights data)

---

## Deployment & IaC Reference

| Service | IaC / Host | Config Location | CI/CD |
|---------|-----------|----------------|-------|
| gp-api | Pulumi → ECS Fargate | `omni/packages/gp-api/deploy/` (`index.ts`, `components/`, `Pulumi.yaml`) | GitHub Actions: Docker build → ECR → `pulumi up` |
| people-api | Pulumi → ECS Fargate | `omni/packages/people-api/deploy/` | GitHub Actions: Docker build → ECR → `pulumi up` |
| election-api | Pulumi → ECS Fargate | `omni/packages/election-api/deploy/` | GitHub Actions: Docker build → ECR → `pulumi up` |
| gp-webapp | Vercel (CLI) | `.github/actions/vercel-deploy` | GitHub Actions, `rootDirectory=packages/gp-webapp` |
| gp-admin | Vercel (CLI) | `.github/actions/vercel-deploy` | Single deploy; Clerk org selects env |
| candidate-sites | Vercel (CLI) | `.github/actions/vercel-deploy` | GitHub Actions |
| gp-ai-projects | Terraform + GitHub Actions (external repo) | `gp-ai-projects/infrastructure/` | Docker → ECR per service |

### CI layout

Workflows live in `omni/.github/workflows/`, one per package; **every package's workflow runs on every PR** (no path filters, except `gp-api-infrastructure-diffs.yml`). The primary validate job is named **"Validate"** across all packages. Shared steps are factored into `.github/actions/` (setup-node-workspace, vercel-deploy, pulumi-deploy). Run the gate locally with `npm run verify -w <package>` (lint + `tsc --noEmit` + vitest).

### Full-stack PR previews

Every PR deploys a per-PR gp-api preview stack and per-PR gp-webapp preview, then runs Playwright e2e against that exact pair. gp-webapp's `NEXT_PUBLIC_API_BASE` is overridden to the deterministic per-PR backend `https://pr-<N>.preview.goodparty.org`. The e2e polls gp-api's Deploy job and confirms `GET /v1/version` serves the expected `github.sha` before running. election-api is not part of this pairing.

### Concurrency: never `cancel-in-progress: true`

Every workflow's concurrency group uses `cancel-in-progress: false`. Canceling a started run can kill `pulumi up` mid-deploy, orphaning the stack's S3 state lock and permanently failing every later deploy of that stack until someone runs `pulumi cancel` by hand.

### Dependency updates (Dependabot)

**Security updates only** — version bumps disabled (`open-pull-requests-limit: 0`). Security PRs target `develop` and self-merge via `dependabot-merge.yml` (sweeps every 30 min; merges approved, green PRs whose last commit is ≥24h old) authenticating as the `omni-automation` GitHub App. Auto-merge stops at `develop`; qa/prod go through normal promotion.

### Branch → Environment Mapping

| Branch | Environment | Notes |
|--------|------------|-------|
| `develop` | Dev | Integration branch; PRs target it. `*-dev.goodparty.org` / `dev.goodparty.org` |
| `qa` | QA | `*-qa.goodparty.org`. people-api has no qa env |
| `master` | Prod | `*.goodparty.org` / `api.goodparty.org` |
| `pr-<N>` | Preview | Backend: `https://pr-<N>.preview.goodparty.org`; frontend: deterministic Vercel alias |

PR-triggered workflows skip PRs targeting `qa`/`master` (`branches-ignore`) — promotion PRs don't re-run PR CI.

### VPC Details

Backends run in a shared VPC (2 public + 2 private subnets, shared security group). IDs are referenced in the Pulumi deploy components.

```bash
# Look up VPC / subnets / security groups
aws ec2 describe-vpcs --filters "Name=tag:Name,Values=*gp*" --query 'Vpcs[].{Id:VpcId,Cidr:CidrBlock}' --output table
aws ec2 describe-subnets --filters "Name=vpc-id,Values=<vpc-id>" --query 'Subnets[].{Id:SubnetId,AZ:AvailabilityZone,Public:MapPublicIpOnLaunch}' --output table
aws ec2 describe-security-groups --filters "Name=vpc-id,Values=<vpc-id>" --query 'SecurityGroups[].{Id:GroupId,Name:GroupName}' --output table
```

---

## External Integrations

| Service | Used By | Key/Config Location |
|---------|---------|-------------------|
| HubSpot | gp-api (CRM sync), gp-data-platform (Airbyte source), gp-ai-projects (DDHQ matcher) | `HUBSPOT_TOKEN` in gp-api .env and Secrets Manager |
| Stripe | gp-api (payments, pro upgrade) | `STRIPE_SECRET_KEY` in gp-api .env |
| Contentful | gp-api (CMS), gp-webapp (rich text rendering) | `CONTENTFUL_SPACE_ID`, `CONTENTFUL_ACCESS_TOKEN` in gp-api .env |
| BallotReady | gp-data-platform (primary election data source via Airbyte + dbt) → election-api | `BALLOT_READY_KEY` in gp-api .env; GraphQL API |
| DDHQ | gp-ai-projects (matcher), gp-data-platform (Airbyte source) | Via Databricks tables |
| L2 (voter data) | gp-data-platform → people-api (200M+ voter records) | `L2_DATA_KEY` in gp-api .env; SFTP → S3 → Databricks → PG |
| Databricks | gp-data-platform (warehouse), gp-ai-projects (read-only queries) | `DATABRICKS_API_KEY`, `DATABRICKS_SERVER_HOSTNAME`, `DATABRICKS_HTTP_PATH` |
| Gemini AI | gp-ai-projects (all LLM calls — no OpenAI) | `GEMINI_API_KEY` |
| Anthropic | gp-ai-projects/engineer_agent (Claude coding agent) | `ANTHROPIC_API_KEY` |
| Tavily | gp-ai-projects (web search for campaign plans) | `TAVILY_API_KEY` |
| Braintrust | gp-api, gp-ai-projects (LLM eval/observability) | `BRAINTRUST_API_KEY` |
| Vercel | gp-webapp, gp-admin, candidate-sites (hosting), gp-api (domain registration/DNS) | `VERCEL_TOKEN`, `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID` |
| Clerk | gp-api (M2M auth guard), gp-admin (M2M + org-per-env), gp-webapp | `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY` |
| Grafana Cloud | gp-api/people-api/election-api (OTel logs/metrics/traces) | `GRAFANA_SERVICE_ACCOUNT_TOKEN` (MCP); dashboards as code in gp-api deploy |
| Sentry | gp-webapp (frontend errors) | Org `goodparty`, region `https://us.sentry.io` |
| Amplitude | gp-webapp (product analytics + feature flags via Experiment) | `AMPLITUDE_PROJECT_API_KEY` in gp-api .env |
| Peerly | gp-api (SMS/calling, identity verification, TCR compliance, phone lists, media) — 5 sub-services | `PEERLY_*` vars in gp-api .env |
| Mailgun | gp-api (email) | `MAILGUN_API_KEY` in gp-api .env |
| Slack | gp-api (multiple channels), gp-ai-projects (Tevyn poll delivery, thread reading) | `SLACK_BOT_*_TOKEN` vars in gp-api .env |
| ClickUp | gp-ai-projects/engineer_agent (task management), agent MCP (design docs, read-only) | `CLICKUP_API_KEY` |
| ForwardEmail | gp-api (email forwarding for purchased domains) | Via domains service |
| eCanvasser | gp-api (door knocking/canvassing integration) | Via ecanvasserIntegration module |
| Segment | gp-api (analytics tracking), gp-webapp (analytics-next) | Via segment module |
| Google OAuth | gp-webapp (social login) | `@react-oauth/google` |
| Google Maps | gp-webapp (candidate directory map) | `@react-google-maps/api` |
| Google Sheets | gp-ai-projects (DDHQ matcher data source) | `google-api-python-client` |

---

## Dev Commands Quick Reference

Run from the omni repo root (`$PROJECT_ROOT/omni`). `npm`'s `-w` resolves either a workspace name or its path (`-w packages/<dir>`).

```bash
# First-time setup
cd $PROJECT_ROOT/omni && nvm use && npm install   # installs all workspaces; inits ai-rules submodule

# Core loop (Postgres + gp-api :3000 + gp-webapp :4000)
npm run dev

# Per-app
npm run start:dev -w gp-api            # :3000
npm run dev       -w packages/gp-webapp # :4000
npm run start:dev -w election-api      # :3001
npm run start:dev -w people-api        # :3002
npm run dev       -w gp-admin          # :3500
npm run dev       -w candidate-sites   # :4001

# Prisma (all three backends, from root)
npm run generate:prisma
npm run generate:prisma:gp-api
npm run migrate:dev -w gp-api          # gp-api migrations

# Tests / gate
npm run test   -w gp-api               # vitest for a package
npm run verify -w gp-api               # lint + tsc --noEmit + vitest (the gate)
npx vitest run packages/gp-api/src/path/to/file.test.ts

# Infra (gp-api)
npm run infra <diff|deploy> <env> -w gp-api

# External repos
cd $PROJECT_ROOT/gp-ai-projects && uv sync && uv run ai_generated_campaign_plan/orchestrator.py
cd $PROJECT_ROOT/gp-data-platform/airflow/astro && astro dev start  # :8080
```

---

## Monitoring

| Tool | What | Access |
|------|------|--------|
| Grafana Cloud | OTel logs (Loki), metrics (Prometheus), traces (Tempo) for gp-api/people-api/election-api | https://goodparty.grafana.net; `GRAFANA_SERVICE_ACCOUNT_TOKEN`. Datasource UIDs: Loki `grafanacloud-logs`, Tempo `grafanacloud-traces`, Prometheus `grafanacloud-prom` |
| Sentry | Frontend errors (gp-webapp) | Org `goodparty`, region `https://us.sentry.io` |
| Amplitude | Product analytics + feature flags (Experiment) | Via gp-webapp |
| Braintrust | LLM eval/observability for AI services | `BRAINTRUST_API_KEY` |
| Slack channels | Deploy notifications, AI failures, P2V issues, poll delivery | Configured in gp-api |
| SNS | Pipeline failure alerts | ddhq-matcher, serve-analyze, engineer-agent |

**Narrowing Grafana logs** — filter by `service_name` (`gp-api` | `election-api` | `people-api`) and `deployment_environment_name` (`dev` | `qa` | `prod`):

```logql
{service_name="gp-api", deployment_environment_name="prod"}
{service_name="election-api", deployment_environment_name="dev"} |= "error"
```

### MCP tools (for agents working in omni)

Configured in `omni/.mcp.json`:

| Server | Transport | For |
|--------|-----------|-----|
| `grafana` | stdio | Logs/metrics/traces — priority server for debugging. Needs `GRAFANA_SERVICE_ACCOUNT_TOKEN` + `uvx` on PATH |
| `sentry` | http | Frontend error investigation. OAuth on first use |
| `playwright` | stdio | Drive a real browser for UI verification / e2e |
| `clickup` | http | Tasks + design docs (read-only by default). OAuth on first use |
