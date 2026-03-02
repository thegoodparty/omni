# Platform Overview

Quick reference for the complete GoodParty tech ecosystem. No sensitive values — only references to where they live.

## Prerequisites

**books/.env variables**: `$PROJECT_ROOT`, `$AWS_REGION`, `$AWS_PROFILE`

**Identity**:
- **AWS Region**: `$AWS_REGION` | **AWS_PROFILE**: `$AWS_PROFILE` | Account ID: `aws sts get-caller-identity --query Account --output text`
- **GitHub Org**: `thegoodparty`
- **Domain**: `goodparty.org` (Route53 zone: `aws route53 list-hosted-zones --query 'HostedZones[].{Name:Name,Id:Id}' --output table`)

---

## Codebases

All under `$PROJECT_ROOT/`. GitHub org: `thegoodparty`.

### Runtime Services

| Project | Stack | Local Port | Prod URL | IaC | Deploy Trigger |
|---------|-------|-----------|----------|-----|----------------|
| **gp-api** | NestJS 11/Fastify, Prisma, PG | 3000 | `api.goodparty.org` | Pulumi (`deploy/index.ts`) | GitHub Actions → CodeBuild → ECS |
| **people-api** | NestJS 11/Fastify, Prisma 6, PG | 3002 | `people-api.goodparty.org` | SST v2 (`deploy/sst.config.ts`) | GitHub Actions → CodeBuild → ECS |
| **election-api** | NestJS/Fastify, Prisma, PG | 3000 | `election-api.goodparty.org` | Pulumi (`deploy/index.ts`) | GitHub Actions → CodeBuild → ECS |
| **gp-ai-projects** | Python/FastAPI, Gemini | — | ALBs: `ai-prod`, `ai-dev`, `ai-qa` | Terraform (`infrastructure/`) | GitHub Actions → ECR → ECS Fargate |

### Frontend Applications

| Project | Stack | Local Port | Deployed On |
|---------|-------|-----------|-------------|
| **gp-webapp** | Next.js 15, React 19, Tailwind 3, MUI 7 | 4000 | Vercel |
| **candidate-sites** | Next.js 15, React 19, Tailwind 3, MUI 7 | 4001 | Vercel |

### Data & Analysis

| Project | Stack | Purpose |
|---------|-------|---------|
| **gp-data-platform** | Airbyte + dbt + Databricks | Full data pipeline: ingest from 9+ sources, transform with 460+ dbt models, write back to all PG databases |
| **ddhq-null-analysis** | Python, Playwright, Gemini | One-off: audit of 4,231 candidates with missing DDHQ election results |
| **playground** | Python, NetworkX, Matplotlib | Decision tree visualizations (candidate viability, path-to-victory workflows) |

### Utilities

| Project | Stack | Purpose |
|---------|-------|---------|
| **gp-data** | — | Data storage directory |

---

## How Services Connect

```
Users → goodparty.org (Vercel: gp-webapp, ~108 pages)
         ├── middleware proxies /api/v1/* to gp-api (injects JWT from cookies)
         ├── direct GET to election-api for public election data (no auth)
         └── candidate-sites (Vercel) for candidate pages → calls gp-api

gp-api (39 controllers, 20+ Prisma models)
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
  ├── SQS (single FIFO queue, 7 message types)
  │     GENERATE_AI_CONTENT      → AI content generation
  │     PATH_TO_VICTORY          → Win number calculations (3 retry max, gold/silver flows)
  │     TCR_COMPLIANCE_STATUS_CHECK → Peerly 10DLC verification
  │     DOMAIN_EMAIL_FORWARDING  → ForwardEmail domain setup
  │     POLL_CREATION            → Sample contacts + send CSV to Tevyn via Slack
  │     POLL_EXPANSION           → Expand poll audience (exclude already sent)
  │     POLL_ANALYSIS_COMPLETE   → Process poll results from gp-ai-projects
  │
  ├── 11 vendor integrations (see External Integrations)
  └── Aurora PG: gp-api-db-prod (20+ models)

gp-ai-projects (uv workspace monorepo, 5 packages)
  ├── Campaign Plan API          (FastAPI, Gemini 2.5 Flash/Pro, Tavily web search)
  ├── Serve-Analyze Pipeline     (V1: consolidate → cluster → SQS publish)
  ├── DDHQ Matcher               (HubSpot-DDHQ race matching via Google Sheets)
  ├── Engineer Agent             (Claude Opus via claude-agent-sdk, triggered by ClickUp tags)
  ├── ClickUp Bot Lambda         (webhook → ECS task trigger)
  ├── Gemini API                 (2.5 Flash/Pro, 3 Flash/Pro Preview)
  ├── Databricks                 (read-only voter/election data)
  ├── Tavily                     (web search for campaign plans)
  ├── Braintrust                 (LLM eval/observability)
  └── SQS → gp-api              (PollAnalysisCompleteEvent)

gp-data-platform (dbt + Databricks, no production Airflow DAGs yet)
  ├── Airbyte → Databricks       (9 sources: HubSpot, BallotReady, Amplitude, Stripe, gp-api DB, DDHQ, TechSpeed, BallotReady S3, L2)
  ├── dbt transforms             (387 staging → 52 intermediate → 23 marts)
  └── 4 PySpark write models →   election-api PG, people-api PG, gp-api voter PG
```

### Auth Between Services

| From | To | Method | Details |
|------|----|--------|---------|
| Browser → gp-webapp | Cookie | `token` HTTP-only cookie (120-day expiry), `user` readable cookie |
| gp-webapp middleware → gp-api | JWT Bearer | Middleware intercepts `/api/v1/*`, injects `Authorization` header from cookie |
| gp-api → people-api | S2S JWT Bearer | Signed with `PEOPLE_API_S2S_SECRET`, 5-min TTL, cached, issuer: `gp-api` |
| gp-api auth guards | — | Dual: `ClerkM2MAuthGuard` (machine-to-machine) + `JwtAuthGuard` (user sessions) |
| people-api | — | `S2SAuthGuard` (global), verifies JWT with shared secret, localhost bypass in dev |
| election-api | — | No auth (public read-only API) |
| Admin impersonation | — | `impersonateToken`/`impersonateUser` cookies override normal auth at every level |

### Frontend → Backend URL Config

| App | Config File | Env Vars |
|-----|------------|----------|
| gp-webapp | `gp-webapp/appEnv.ts` | `NEXT_PUBLIC_API_BASE` (default: `gp-api-dev.goodparty.org`), `NEXT_PUBLIC_ELECTION_API_BASE` (default: `election-api-dev.goodparty.org`), `NEXT_PUBLIC_OLD_API_BASE` |
| candidate-sites | `candidate-sites/appEnv.ts` | `NEXT_PUBLIC_API_BASE` (default: `localhost:3000/v1`) |

---

## Service Deep Dives

### gp-api — Central Backend

**39 API controllers** organized by domain:

| Domain | Routes | Purpose |
|--------|--------|---------|
| Campaigns | `/campaigns`, `/public-campaigns`, `/campaigns/:id/positions`, `/campaigns/tasks`, `/campaigns/mine/update-history`, `/campaigns/map` | Core campaign CRUD, positions, weekly tasks, history, map |
| AI | `/campaigns/ai/chat`, `/campaigns/ai` | AI chat assistant (thread management), AI content generation |
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
| Admin | `/admin/campaigns` | Campaign management, P2V stats |
| Other | `/health`, `/jobs`, `/queue`, `/error-logger`, `/subscribe`, `/declare`, `/ecanvasser`, `/top-issues`, `/positions`, `/community-issues`, `/elected-office` | Utilities, integrations |

**Prisma schema** (20+ models in `prisma/schema/`): Campaign, User, PathToVictory, AiChat, Website, Domain, Poll, PollIssue, PollIndividualMessage, Outreach, ScheduledMessage, CampaignPosition, CampaignPlanVersion, CampaignUpdateHistory, TcrCompliance, VoterFileFilter, ElectedOffice, TopIssue, Position, CommunityIssue, Content, BlogArticleMeta, WebsiteContact, WebsiteView, CensusEntity, Ecanvasser

**Global interceptors**: `AdminAuditInterceptor`, `BlockedStateInterceptor` (tracks user-blocking issues)

**Vendor services** in `src/vendors/`: aws (S3, SQS), braintrust, contentful, ecanvasserIntegration, forwardEmail, google, peerly (5 sub-services), segment, slack, stripe, vercel

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

**Deploy**: SST v2 — ECS Fargate (prod: 1 vCPU, 4GB, 2-16 tasks auto-scaling at 50% CPU/mem; dev: 0.5 vCPU, 2GB, 1-4 tasks). Aurora PG prod: `db.r6g.4xlarge` x2.

### election-api — Election Data Service

**Purpose**: Read-only public API over BallotReady election data. No auth required. All data written by gp-data-platform dbt models.

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

**Deploy**: Pulumi — ECS Fargate (prod: 1024 CPU, 4096 MB, 2 tasks; dev/qa: 512 CPU, 2048 MB, 1 task). Aurora Serverless v2.

### gp-ai-projects — AI Services

**uv workspace monorepo** with 5 packages + shared utilities. Python 3.11+. All LLM calls use **Gemini exclusively** (no OpenAI).

**Services**:

| Service | Runtime | Trigger | Purpose |
|---------|---------|---------|---------|
| **Campaign Plan API** | FastAPI | HTTP from gp-api | Generate 6-section campaign plans (overview, strategy, timeline, budget, community, voter contact). Uses Gemini 2.5 Flash + Tavily web search. Returns PDF/JSON. |
| **Serve-Analyze (V1 Pipeline)** | ECS Fargate | Lambda trigger | Analyze constituent poll messages — consolidate → hierarchical clustering (embeddings, UMAP/PCA, HDBSCAN) → LLM ranking of top 3 clusters → publish `PollAnalysisCompleteEvent` to SQS |
| **DDHQ Matcher** | ECS Fargate | Lambda trigger | Match HubSpot contacts to DDHQ election results via Google Sheets |
| **Engineer Agent** | ECS Fargate | ClickUp webhook → Lambda | Autonomous coding agent using Claude Opus via `claude-agent-sdk`. Clones repos, reads logs, queries Databricks, creates PRs. Two modes: `gpbot-analyze` (investigate) and `gpbot-work` (implement). Max 200 turns. |
| **ClickUp Bot** | Lambda | Webhook | Listens for `taskTagUpdated`, triggers engineer agent ECS task |

**Gemini models used**: `gemini-2.5-flash`, `gemini-2.5-pro`, `gemini-2.5-flash-lite`, `gemini-3-flash-preview`, `gemini-3-pro-preview`, `gemini-embedding-001`

**Campaign plan generation flow**:
1. Clean input data (city/state from jurisdiction, format dates)
2. Parallel generation via `asyncio.gather()`: Overview, Strategic Landscape, Budget, Know Your Community (4 Tavily searches), Voter Contact Plan
3. Sequential: Campaign Timeline (depends on community + voter contact, 2 Tavily searches)
4. Assembly: Header + 6 sections → PDF/JSON output
5. Cost tracking per section (LLM + Tavily)

**Clustering pipeline** (hierarchical discovery): data_loader → content_filter → ai_message_processor → embedding_generator (Gemini embeddings) → dimensionality_reducer (UMAP/PCA) → hierarchical_cluster_engine (HDBSCAN) → cluster_analyzer (Gemini LLM) → visualization_generator

**Deployment**: All containers share one ECR repo (`gp-ai-projects`) with different tags. All target **linux/arm64** (Graviton). CI: GitHub Actions builds Docker image → pushes to ECR. On-demand ECS clusters: `serve-analyze-{env}`, `ddhq-matcher-{env}`, `engineer-agent-{env}`.

### gp-webapp — Main Frontend

**Next.js 15 App Router** with ~108 pages across 14 route groups:

| Route Group | URL Pattern | Pages | Purpose |
|---|---|---|---|
| `(candidate)` | `/dashboard/*`, `/onboarding/*` | ~37 | Candidate dashboard, AI assistant, contacts, door knocking, outreach, polls, website builder, voter records, content, pro upgrade |
| `(company)` | `/about`, `/team`, `/contact` | ~10 | Public company/marketing pages |
| `(entrance)` | `/login`, `/sign-up` | ~7 | Auth flows (email/password + Google OAuth) |
| `(landing)` | `/run-for-office`, `/elections/*`, `/academy` | ~16 | Marketing landing pages |
| `(user)` | `/profile/*` | ~3 | User profile, texting compliance |
| `admin` | `/admin/*` | ~16 | Internal admin tools (campaigns, P2V stats, AI content, user management) |
| `blog` | `/blog/*` | ~4 | Contentful-powered articles |
| `candidates` | `/candidates/*` | ~2 | Public candidate directory with map |
| `polls` | `/polls/*` | ~4 | Public polls onboarding flow |
| Other | `/`, `/c/[vanityPath]`, `/candidate/[name]/[office]`, `/sales/*` | ~9 | Homepage, vanity URLs, individual candidates |

**API client architecture** (3-tier fetch):
- `clientFetch.ts` — Client components: builds URLs, adds Bearer token, `credentials: include`
- `serverFetch.ts` — Server components: reads JWT from cookies via `next/headers`
- `unAuthFetch.ts` — Public endpoints: GET-only with 1-hour ISR revalidation
- **Middleware proxy**: Client-side requests go to `/api/v1/*` (same origin), middleware rewrites to `API_ROOT` with injected auth header — browser never sees cross-origin requests

**State management**: React Context (12+ providers in `PageWrapper`) + TanStack React Query (5-min stale, 10-min GC). Feature flags via Amplitude Experiment.

**Key dependencies**: React 19, TanStack React Query, react-hook-form, Recharts + Chart.js, Quill (rich text), Stripe.js, Google Maps, Google OAuth, Segment analytics, New Relic browser agent, Playwright (e2e), Vitest (unit)

**Testing**: 4 unit tests (Vitest + RTL), 22 e2e tests (Playwright — auth, navigation, pages, dashboard features, sitemap)

### candidate-sites — Candidate Campaign Websites

**Purpose**: Renders public single-page campaign websites for GoodParty candidates. Dynamic route `[vanityPath]` fetches website data from gp-api.

**Sections**: HeroSection (photo, title, tagline) → AboutSection (bio, issues) → ContactSection (form) → Footer (committee, privacy)

**Features**: Themeable (light/dark/custom via `content.theme`), view tracking analytics, 3600s ISR revalidation. Connects to gp-api via `fetchHelper` → `${API_ROOT}/websites/{vanityPath}/view`.

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

**Backend** (`gp-api/src/campaigns/services/campaigns.service.ts:429-475`):

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

**Frontend** (`CampaignStatusProvider.tsx`): Fetches status via `fetchCampaignStatus()` (client-side, `revalidate: 10`), stores in React Context. Nav components read from context:
- `DashboardOrContinue.tsx` (desktop): `status === 'candidate'` → Dashboard, else → Continue Onboarding
- `RightSideMobile.tsx` (mobile): same logic

### Key Files

| File | Purpose |
|------|---------|
| `gp-api/src/campaigns/services/campaigns.service.ts:131-153` | `createForUser()` — initial campaign creation |
| `gp-api/src/campaigns/services/campaigns.service.ts:429-475` | `getStatus()` — status + step calculation |
| `gp-api/src/campaigns/services/campaigns.service.ts:485-520` | `launch()` — sets isActive=true |
| `gp-api/src/campaigns/campaigns.types.ts` | `CampaignStatus`, `CampaignLaunchStatus`, `OnboardingStep` enums |
| `gp-webapp/app/(candidate)/onboarding/[slug]/[step]/components/` | Step components: OfficeStep, PartyStep, PledgeStep, CompleteStep |
| `gp-webapp/app/(candidate)/onboarding/shared/ajaxActions.ts` | `doPostAuthRedirect()`, `updateCampaign()`, `onboardingStep()` |
| `gp-webapp/helpers/fetchCampaignStatus.ts` | Client-side status fetch (revalidate: 10s) |
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

The data that powers P2V flows through three dbt layers before reaching the election-api database:

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

6 sub-services, all inheriting `PeerlyBaseConfig` (env: `PEERLY_API_BASE_URL`, `PEERLY_MD5_EMAIL`, `PEERLY_MD5_PASSWORD`, `PEERLY_ACCOUNT_NUMBER`, `PEERLY_SCHEDULE_ID`):

| Service | Purpose | Key Peerly API Endpoints |
|---------|---------|--------------------------|
| `PeerlyAuthenticationService` | JWT auth with auto-renewal (5-min threshold) | `POST /token-auth` |
| `PeerlyIdentityService` | TCR/10DLC identity management, brand submission, Campaign Verify | `POST /identities`, `GET /identities/listByAccount`, `POST /v2/tdlc/{id}/submit`, `POST /v2/tdlc/{id}/approve`, `POST /v2/tdlc/{id}/submit_cv`, `POST /v2/tdlc/{id}/verify_pin` |
| `PeerlyPhoneListService` | Upload voter CSV phone lists, check processing status | `POST /phonelists`, `GET /phonelists/{token}/checkstatus`, `GET /phonelists/{listId}` |
| `PeerlyP2pSmsService` | Create P2P SMS jobs, assign lists, request canvassers, manage agents | `POST /1to1/jobs`, `POST /1to1/jobs/{id}/assignlist`, `POST /v2/p2p/{id}/request_canvassers`, `GET /1to1/agents` |
| `PeerlyP2pJobService` | Orchestrates job creation (media → job → assign list → request canvassers) | Calls MediaService + P2pSmsService |
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
   b. **Create job** — `POST /1to1/jobs` with template (script + media), DID state, schedule ID, identity ID. Auto-assigns HubSpot company owner as Peerly agent (by email lookup via `GET /1to1/agents`)
   c. **Assign phone list** — `POST /1to1/jobs/{jobId}/assignlist`
   d. **Request canvassers** — `POST /v2/p2p/{jobId}/request_canvassers` with authenticated user initials
7. Create `Outreach` DB record with `projectId = jobId`, `status: in_progress`

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
| `/profile/texting-compliance` | TCR compliance form (user route group) |

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

## Data Platform Pipeline (gp-data-platform)

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

### AWS Secrets Manager (10 secrets)

| Secret Name | Used By | Referenced In |
|-------------|---------|---------------|
| `GP_API_DEV` | gp-api (dev + PR previews) | `gp-api/deploy/index.ts:48` |
| `GP_API_QA` | gp-api (qa) | `gp-api/deploy/index.ts:50` |
| `GP_API_PROD` | gp-api (prod) | `gp-api/deploy/index.ts:51` |
| `ELECTION_API_DEV` | election-api (dev + qa) | `election-api/deploy/index.ts:33` |
| `ELECTION_API_PROD` | election-api (prod) | `election-api/deploy/index.ts:35` |
| `PEOPLE_API_DEV` | people-api (dev) | `people-api/deploy/sst.config.ts:97` |
| `PEOPLE_API_PROD` | people-api (prod) | `people-api/deploy/sst.config.ts:94` |
| `AI_SECRETS_DEV` | gp-ai-projects (dev) | ECS task definition |
| `AI_SECRETS_QA` | gp-ai-projects (qa) | ECS task definition |
| `AI_SECRETS_PROD` | gp-ai-projects (prod) | ECS task definition |

Read a secret: `AWS_PROFILE=$AWS_PROFILE aws secretsmanager get-secret-value --secret-id SECRET_NAME --query SecretString --output text | jq .`

### Local .env Files

| Project | .env Location | .env.example |
|---------|--------------|--------------|
| gp-api | `gp-api/.env` | `gp-api/.env.example` (65+ vars: DB, AWS, Stripe, HubSpot, Slack, Peerly, Vercel, NewRelic, etc.) |
| people-api | `people-api/.env` | `people-api/.env.example` (DATABASE_URL, PEOPLE_API_S2S_SECRET, NEW_RELIC) |
| election-api | — | `election-api/.env.example` (DATABASE_URL, CORS_ORIGIN, LOG_LEVEL) |
| gp-ai-projects | `gp-ai-projects/.env` | `gp-ai-projects/.env.example` (GEMINI_API_KEY, TAVILY_API_KEY, DATABRICKS_*, BRAINTRUST_API_KEY) |
| gp-ai-projects/serve | `gp-ai-projects/serve/v1_pipeline/.env` | `gp-ai-projects/serve/v1_pipeline/.env.example` (GEMINI_API_KEY) |
| gp-ai-projects/engineer_agent | `gp-ai-projects/engineer_agent/.env` | `gp-ai-projects/engineer_agent/.env.example` (ANTHROPIC_API_KEY, CLICKUP_API_KEY) |
| gp-data-platform | — | `gp-data-platform/.env.example` (DBT_CLOUD_PROJECT_ID) |
| gp-mcp | `gp-mcp/.env` | `gp-mcp/env.example` |

### Key Env Vars by Service (names only)

**gp-api**: DATABASE_URL, PEOPLE_API_URL, PEOPLE_API_S2S_SECRET, ELECTION_API_URL, AUTH_SECRET, CONTENTFUL_SPACE_ID, CONTENTFUL_ACCESS_TOKEN, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, SQS_QUEUE, HUBSPOT_TOKEN, MAILGUN_API_KEY, OPEN_AI_KEY, STRIPE_SECRET_KEY, L2_DATA_KEY, BALLOT_READY_KEY, SLACK_BOT_*_TOKEN (7 channels), VERCEL_TOKEN, VERCEL_PROJECT_ID, VERCEL_TEAM_ID, PEERLY_*, NEW_RELIC_*, CLERK_SECRET_KEY, GP_WEBAPP_MACHINE_SECRET, BRAINTRUST_API_KEY

**people-api**: DATABASE_URL, PEOPLE_API_S2S_SECRET, NEW_RELIC_*

**election-api**: DATABASE_URL, CORS_ORIGIN

**gp-ai-projects**: GEMINI_API_KEY, TAVILY_API_KEY, DATABRICKS_API_KEY, DATABRICKS_SERVER_HOSTNAME, DATABRICKS_HTTP_PATH, GOODPARTY_API_TOKEN, BRAINTRUST_API_KEY, ANTHROPIC_API_KEY, CLICKUP_API_KEY

---

## AWS Infrastructure

### ECS Clusters & Services (14 active)

| Cluster | Service | Tasks (prod) |
|---------|---------|-------------|
| `gp-master-fargateCluster` | `gp-api-master` | 2 |
| `gp-develop-fargateCluster` | `gp-api-develop` | — |
| `gp-qa-fargateCluster` | `gp-api-qa` | — |
| `gp-pr-{1033,1052,1062,1080,1087}-fargateCluster` | `gp-api-pr-*` | 1 each |
| `election-api-master-fargateCluster` | `election-api-master` | 2 (1024 CPU, 4096 MB) |
| `election-api-develop-fargateCluster` | `election-api-develop` | 1 (512 CPU, 2048 MB) |
| `election-api-qa-fargateCluster` | `election-api-qa` | — |
| `people-api-master-fargateCluster` | `people-api-master` | 2-16 (1 vCPU, 4 GB, auto-scale 50% CPU/mem) |
| `people-api-develop-fargateCluster` | `people-api-develop` | 1-4 (0.5 vCPU, 2 GB) |
| `vpn-cluster` | `vpn-service` | 1 |

On-demand ECS (Lambda-triggered): `serve-analyze-{dev,qa,prod}`, `ddhq-matcher-{dev,qa,prod}`, `engineer-agent-{dev,qa,prod}`

### RDS Aurora PostgreSQL Clusters

| Cluster | Used By | Instance Class |
|---------|---------|---------------|
| `gp-api-db-prod` | gp-api prod | db.serverless |
| `gp-api-db` | gp-api dev | db.serverless |
| `gp-api-db-qa` | gp-api qa | db.serverless |
| `gp-api-pr-{1033,1052,1062,1080,1087}` | PR previews | db.serverless |
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
| `goodparty-terraform-state-$AWS_REGION` | Terraform state |
| `goodparty-iac-state` | IaC state |

```bash
# Look up CloudFront distributions
aws cloudfront list-distributions --query 'DistributionList.Items[].{Id:Id,Domain:DomainName,Origins:Origins.Items[0].DomainName}' --output table

# Look up S3 buckets
aws s3 ls | grep -i assets
```

### SQS (42 FIFO queues)

Per-stage: `{stage}-campaign-queue.fifo` + DLQ for develop, master, qa, PR previews
Per-developer: `{DevName}-campaign-queue.fifo` + DLQ (one per team member)

### Lambda Functions (15)

| Function | Purpose |
|----------|---------|
| `newrelic-log-forwarder-{dev,qa,prod}` | Forward logs to New Relic |
| `serve-analyze-trigger-{dev,qa,prod}` | Trigger serve-analyze ECS tasks |
| `ddhq-matcher-trigger-{dev,qa,prod}` | Trigger DDHQ matcher ECS tasks |
| `clickup-bot-prod` | ClickUp webhook → engineer agent ECS trigger |
| `shared-slack-notifier` | Slack notifications for deploys |
| `databricks-s3-ingest` (x2) | S3 → Databricks ingestion |
| `s3-ballotready` | BallotReady S3 processing |

### ECR Repositories

`gp-api`, `election-api`, `gp-ai-projects` (shared by serve-analyze, ddhq-matcher, engineer-agent with different tags), `sst-asset`, `vpn-repo`

### CodeBuild Projects

| Project | Deploys |
|---------|---------|
| `gp-deploy-build-{master,qa,develop}` | gp-api |
| `election-api-deploy-build-{master,qa,develop}` | election-api |
| `people-api-deploy-build-{master,develop}` | people-api |

### Route53 Hosted Zones

`goodparty.org`, `thegoodparty.org` (legacy), `rf.goodparty.org`, `sst`

### SNS Topics (failure alerts)

`ddhq-matcher-failures-{dev,qa,prod}`, `serve-analyze-pipeline-failures-{dev,qa,prod}`, `engineer-agent-failures-{dev,qa,prod}`, `GP-Prod-SNS`

### DynamoDB

`master-poll-insights-740c043` (poll insights data)

---

## Deployment & IaC Reference

| Service | IaC Tool | Config Location | CI/CD |
|---------|---------|----------------|-------|
| gp-api | Pulumi (via SST wrapper) | `gp-api/deploy/index.ts`, `gp-api/deploy/components/` | `.github/workflows/` → CodeBuild |
| people-api | SST v2 | `people-api/deploy/sst.config.ts` | `.github/workflows/main.yml` → CodeBuild |
| election-api | Pulumi | `election-api/deploy/index.ts`, `election-api/deploy/components/` | `.github/workflows/main.yml` → Pulumi CLI |
| gp-ai-projects | Terraform + GitHub Actions | `infrastructure/`, `.github/workflows/` | Docker build → ECR push per service |
| gp-webapp | Vercel | `vercel.json` / Vercel dashboard | Git push to develop/qa/master |
| candidate-sites | Vercel | Vercel dashboard | Git push |

### Branch → Environment Mapping

| Branch | Environment | API URL Pattern |
|--------|------------|----------------|
| `develop` | Dev | `*-dev.goodparty.org` |
| `qa` | QA | `*-qa.goodparty.org` |
| `master` | Prod | `*.goodparty.org` (no prefix) or `api.goodparty.org` |
| `pr-XXXX` | Preview | `gpapi-pr-XXXX.$AWS_REGION.elb.amazonaws.com` |

### VPC Details (hardcoded in gp-api deploy)

The deploy uses a single VPC with 2 public and 2 private subnets, plus a shared security group. These IDs are hardcoded in `gp-api/deploy/index.ts`.

```bash
# Look up VPC
aws ec2 describe-vpcs --filters "Name=tag:Name,Values=*gp*" --query 'Vpcs[].{Id:VpcId,Cidr:CidrBlock}' --output table

# Look up subnets
aws ec2 describe-subnets --filters "Name=vpc-id,Values=<vpc-id>" --query 'Subnets[].{Id:SubnetId,AZ:AvailabilityZone,Public:MapPublicIpOnLaunch}' --output table

# Look up security groups
aws ec2 describe-security-groups --filters "Name=vpc-id,Values=<vpc-id>" --query 'SecurityGroups[].{Id:GroupId,Name:GroupName}' --output table
```

### CodeBuild Source Overrides

When deploying SST configurations that differ from the main branch, use S3 source overrides instead of environment variables:

```bash
aws codebuild start-build \
  --project-name people-api-deploy-build-master \
  --source-type-override S3 \
  --source-location-override bucket-name/archive.tar.gz \
  --buildspec-override file:///path/to/custom-buildspec.yml
```

### SST State Management

- SST uses distributed locking via AWS AppSync and DynamoDB
- Lock errors: run `AWS_PROFILE=$AWS_PROFILE npx sst unlock --stage=stage-name`
- State is tracked per stage, allowing concurrent deployments to different stages

---

## External Integrations

| Service | Used By | Key/Config Location |
|---------|---------|-------------------|
| HubSpot | gp-api (CRM sync), gp-data-platform (Airbyte source), gp-ai-projects (DDHQ matcher) | `HUBSPOT_TOKEN` in gp-api .env and Secrets Manager |
| Stripe | gp-api (payments, pro upgrade) | `STRIPE_SECRET_KEY`, `STRIPE_WEBSOCKET_SECRET` in gp-api .env |
| Contentful | gp-api (CMS), gp-webapp (rich text rendering) | `CONTENTFUL_SPACE_ID`, `CONTENTFUL_ACCESS_TOKEN` in gp-api .env |
| BallotReady | gp-data-platform (primary election data source via Airbyte + dbt) → election-api | `BALLOT_READY_KEY` in gp-api .env; GraphQL API |
| DDHQ | gp-ai-projects (matcher), gp-data-platform (Airbyte source) | Via Databricks tables |
| L2 (voter data) | gp-data-platform → people-api (200M+ voter records) | `L2_DATA_KEY` in gp-api .env; SFTP → S3 → Databricks → PG |
| Databricks | gp-data-platform (warehouse), gp-ai-projects (read-only queries) | `DATABRICKS_API_KEY`, `DATABRICKS_SERVER_HOSTNAME`, `DATABRICKS_HTTP_PATH` |
| Gemini AI | gp-ai-projects (all LLM calls — no OpenAI) | `GEMINI_API_KEY`; models: 2.5 Flash/Pro, 3 Flash/Pro Preview, embedding-001 |
| Tavily | gp-ai-projects (web search for campaign plans) | `TAVILY_API_KEY` |
| Braintrust | gp-api, gp-ai-projects (LLM eval/observability) | `BRAINTRUST_API_KEY` |
| Anthropic | gp-ai-projects/engineer_agent (Claude Opus coding agent) | `ANTHROPIC_API_KEY` |
| Vercel | gp-webapp, candidate-sites (hosting), gp-api (domain registration/DNS) | `VERCEL_TOKEN`, `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID` in gp-api .env |
| New Relic | gp-api, people-api (APM), gp-webapp (browser agent) | `NEW_RELIC_APP_NAME`, `NEW_RELIC_LICENSE_KEY` |
| Amplitude | gp-webapp (product analytics + feature flags via Experiment) | `AMPLITUDE_PROJECT_API_KEY` in gp-api .env |
| Peerly | gp-api (SMS/calling, identity verification, TCR compliance, phone lists, media) — 5 sub-services | `PEERLY_*` vars in gp-api .env |
| Mailgun | gp-api (email) | `MAILGUN_API_KEY` in gp-api .env |
| Slack | gp-api (7 channels), gp-ai-projects (Tevyn poll delivery, thread reading) | `SLACK_BOT_*_TOKEN` vars in gp-api .env |
| Clerk | gp-api (M2M auth guard) | `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY` in gp-api .env |
| ClickUp | gp-ai-projects/engineer_agent (task management) | `CLICKUP_API_KEY` in engineer_agent .env |
| ForwardEmail | gp-api (email forwarding for purchased domains) | Via domains service |
| eCanvasser | gp-api (door knocking/canvassing integration) | Via ecanvasserIntegration module |
| Segment | gp-api (analytics tracking), gp-webapp (analytics-next) | Via segment module |
| Google OAuth | gp-webapp (social login) | `@react-oauth/google` |
| Google Maps | gp-webapp (candidate directory map) | `@react-google-maps/api` |
| Google Sheets | gp-ai-projects (DDHQ matcher data source) | `google-api-python-client` |

---

## Dev Commands Quick Reference

```bash
# gp-webapp
cd $PROJECT_ROOT/gp-webapp && npm run dev                    # :4000
cd $PROJECT_ROOT/gp-webapp && npm run storybook              # :6006
cd $PROJECT_ROOT/gp-webapp && npm test                       # vitest unit tests
cd $PROJECT_ROOT/gp-webapp && npm run test:e2e               # playwright e2e

# gp-api
cd $PROJECT_ROOT/gp-api && npm run start:dev                 # :3000
cd $PROJECT_ROOT/gp-api && npm run migrate:dev               # run migrations
cd $PROJECT_ROOT/gp-api && npm run seed                      # seed DB
cd $PROJECT_ROOT/gp-api && npm run codegen                   # generate GraphQL types

# people-api
cd $PROJECT_ROOT/people-api && npm run start:dev              # :3002

# election-api
cd $PROJECT_ROOT/election-api && npm run start:dev            # :3000

# candidate-sites
cd $PROJECT_ROOT/candidate-sites && npm run dev               # :4001

# gp-ai-projects
cd $PROJECT_ROOT/gp-ai-projects && uv sync && uv run ai_generated_campaign_plan/orchestrator.py

# gp-mcp
cd $PROJECT_ROOT/gp-mcp && uv sync && uv run main.py         # :8080

# gp-data-platform (Airflow)
cd $PROJECT_ROOT/gp-data-platform/airflow/astro && astro dev start  # :8080
```

---

## Monitoring

| Tool | What | Access |
|------|------|--------|
| New Relic | APM for gp-api, people-api; browser agent for gp-webapp | `NEW_RELIC_LICENSE_KEY` in Secrets Manager |
| CloudWatch | All ECS container logs | `AWS_PROFILE=$AWS_PROFILE aws logs` |
| Amplitude | Product analytics + feature flags (Experiment) | Via gp-webapp |
| Braintrust | LLM eval/observability for AI services | `BRAINTRUST_API_KEY` |
| Slack channels | Deploy notifications, AI failures, P2V issues, poll delivery | 7 channels configured in gp-api |
| SNS | Pipeline failure alerts | ddhq-matcher, serve-analyze, engineer-agent |
