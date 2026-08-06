# Architecture

How the pieces fit together. For per-package detail, read that package's `CLAUDE.md`.

## Shape of the system

A Next.js frontend, a NestJS API monolith, one specialized data microservice, an
admin console, and a typed SDK/contracts layer. Boring, deliberately: Postgres,
Vercel, Next.js, NestJS, background workers on SQS. We spend novelty only when
nothing boring would work.

```
                 ┌──────────────┐        ┌──────────────┐
                 │  gp-webapp   │        │  gp-admin    │
                 │  (Vercel)    │        │  (Vercel)    │
                 └──────┬───────┘        └──────┬───────┘
                        │ JWT cookie            │ SDK + Clerk M2M
                        ▼                       ▼
                     ┌────────────────────────────┐
                     │            gp-api            │
                     │      (NestJS, ECS Fargate)   │
                     └───┬───────────┬──────────┬───┘
              Prisma     │           │ HTTP     │ HTTP
           (people-db)   ▼           ▼          ▼
                ┌─────────────┐ ┌──────────────┐ ┌────────────────┐
                │  people-db  │ │ election-api │ │ gp-ai-projects │
                │  (Aurora)   │ │    (ECS)     │ │  (ext. Python) │
                └─────────────┘ └──────────────┘ └────────────────┘
```

- **gp-webapp -> gp-api:** all authenticated user requests. JWT in an HTTP-only
  cookie, `credentials: 'include'`.
- **gp-admin -> gp-api:** via `@goodparty_org/sdk`, authenticated with a
  per-environment Clerk M2M secret (no cookie flow). One Vercel deploy fronts
  dev/prod by switching the active Clerk org.
- **gp-api -> people-db:** direct Prisma access to the people-db Postgres cluster
  (`packages/gp-api/src/peopleDb/`, ported from the retired `people-api` repo
  package) for voter queries, demographics, and CSV exports. This is the only
  path — the HTTP fallback and the flag that gated it are gone. The people-api
  service is still deployed but frozen, with no repo package or CI pipeline in
  omni.
- **gp-api -> election-api:** direct HTTP for election/race data.
- **gp-api -> gp-ai-projects:** HTTP for AI campaign-plan generation (external repo).

## Auth flows

| Flow                        | Mechanism           | Notes                                            |
| --------------------------- | ------------------- | ------------------------------------------------ |
| User -> gp-webapp -> gp-api | JWT cookie          | HTTP-only cookie, `credentials: 'include'`       |
| Staff -> gp-admin -> gp-api | Clerk org + M2M     | Active Clerk org selects env; per-env M2M secret |
| gp-api -> people-db         | Prisma (SSM creds)  | Direct DB connection; see `PeopleDbUrlProvider`  |
| gp-api -> election-api      | HTTP                | Internal network / public data                   |
| M2M caller -> gp-api        | Bearer `mt_*` token | `ClerkM2MAuthGuard`                              |
| External -> gp-webapp       | Public              | Public election/candidate pages                  |

gp-api runs three global guards in order: `ClerkM2MAuthGuard`, `SessionGuard`,
`RolesGuard`. Detail and decorators: `packages/gp-api/src/authentication/CLAUDE.md`.

## Contracts — the cross-service source of truth

`@goodparty_org/contracts` (`packages/contracts`) holds the Zod schemas and types
for anything that crosses a service boundary: S2S fetch payloads, SQS message
bodies, webhook bodies, and shared API response shapes. The SDK is built on top of
it; gp-admin consumes the SDK.

Rule: when you change a cross-boundary shape, update the contract in the **same PR**
as the producer and consumer. Read both code paths first and confirm every field the
producer sends is read and every field the consumer expects is sent. gp-webapp
currently keeps some of its own hand-rolled types in `packages/gp-webapp/gpApi` +
`helpers/types.ts`; prefer contracts for new cross-service shapes.

**In-tree, not published.** `@goodparty_org/contracts` and `@goodparty_org/sdk`
(`packages/gp-sdk`) are in-tree workspace packages, not live npm-registry packages —
despite the scoped names. Consumers depend on them via a `"*"` workspace dependency
and a node_modules symlink, so a change is live the moment it builds: no version
bump, no publish, no install. That is why a cross-boundary change goes in one PR
rather than through a release. npm publishing is **intentionally disabled** in omni
(see the "publish ... not enabled in omni yet" notes in
`.github/workflows/{contracts,gp-sdk}.yml`). Both were published pre-monorepo; don't
assume the scoped name implies a registry release.

## Data and schemas

Each backend owns its own Postgres database, managed by Prisma with modular
`prisma/schema/*.prisma` files.

- **gp-api:** user, campaign, pathToVictory, aiChat, website, outreach, payments,
  etc. See `packages/gp-api/prisma/CLAUDE.md`. It also holds a second, read-only
  Prisma client for people-db (`src/peopleDb/`) — Voter (partitioned by state),
  District, DistrictStats. Mostly raw SQL. ~200M+ L2 records — treat voter data as
  restricted. See `packages/gp-api/src/peopleDb/CLAUDE.md`.
- **election-api:** Race, Place, District, Position, Candidacy, ProjectedTurnout.

Never edit an applied migration under `prisma/schema/migrations/<timestamp>/`.

### Voter / people data path (unified)

Both products that surface voter data — Serve (elected office) and Win (campaign) —
read it through gp-api, via the same `/dashboard/contacts` experience in
gp-webapp. The browser calls gp-api (`GET /v1/contacts`, the voter-file filter
endpoints, and the contact-engagement endpoints); gp-api runs its own queries
(mostly raw SQL) against the partitioned `Voter` table in people-db, in-process
via `src/peopleDb/` — the sole path, now that the legacy people-api HTTP
fallback is gone. The raw SQL is an internal gp-api/people-db implementation
detail, not something gp-webapp talks to.

- **Serve** has been on this People-API path.
- **Win** is now on it too, gated by the `win-voter-data` flag + `campaign.isPro`.
  This replaces the older Win voter-file experience at `dashboard/voter-records/`,
  which read the pre-People-API `voters.voterFile.*` endpoints. That legacy page is
  **not removed yet** — it still serves un-migrated Win users until the post-rollout
  cleanup (ENG-10436). New Win voter work goes through `dashboard/contacts/`.

Adoption of the unified path is measured via the `Contacts` analytics events, which
carry a `context: 'win' | 'serve'` property. Detail:
`packages/gp-webapp/app/dashboard/contacts/CLAUDE.md`.

## External repos (not in omni)

Some systems live outside this monorepo. Consult them when:

- **gp-ai-projects** (`thegoodparty/gp-ai-projects`) — Python AI/ML pipeline:
  campaign-plan generation, civic message analysis, HubSpot-DDHQ matching. Read it
  when changing how gp-api calls AI generation, or when debugging plan output. It
  also hosts the **PMF Engine runtime**: gp-api's `agentExperiments` module enqueues
  an `experiment_run` to SQS, which an ingest Lambda places on a DynamoDB priority
  queue; a scheduler Lambda launches the single-use Fargate agent, whose only egress
  is a privileged broker service; results come back on gp-api's `{branch}-Queue.fifo`
  (consumed in `queue/consumer/`, with `communityIssues` a downstream consumer).
  The experiment playbooks themselves are in-tree at `packages/runbooks/experiments/`.
  See `packages/gp-api/src/agentExperiments/CLAUDE.md`.
- **gp-marketing** (`thegoodparty/gp-marketing`) — the public marketing site. It
  moved out of gp-webapp; `gp-webapp` is the product app for candidates & elected
  officials, not the marketing site. Marketing changes go there, not here.
- **ops** (`thegoodparty/ops`) — operational scripts and the Delegate agent
  framework. **Relevant to code reviews** — the review automation and agent dispatch
  logic live here, so consult it when changing or debugging review flows.
