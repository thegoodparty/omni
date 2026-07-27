# CLAUDE.md

Guidance for Claude Code and other AI agents working in `people-api`. Keep this file short — push detail into `docs/`.

## Project

NestJS/Fastify internal API serving 200M+ US voter records sourced from L2 (a voter-data vendor). Called exclusively by `gp-api` via S2S JWT — no end-user-facing routes. Postgres via Prisma; the `Voter` table lives in the `green` schema and is partitioned by state.

## Commands (most-used first)

```bash
npm run start:dev              # Dev server (:3002) with watch
npm test                       # vitest run
npx vitest run src/people/utils/filters.sql.utils.test.ts   # single file
npm run test:watch             # watch mode
npm run lint                   # eslint --fix on {src,apps,libs,test}/**/*.ts
npm run lint-format            # lint + prettier --write
npm run build                  # nest build → dist/

npm run migrate:dev            # create/apply a migration
npm run migrate:reset          # reset DB + migrate (LOCAL ONLY)
npm run migrate:deploy         # apply pending migrations (CI/prod)
npm run generate               # regenerate Prisma client
npm run seed                   # @faker-js seed (local dev only)

npm run ai-rules:update        # advance the ai-rules submodule pin
```

`npm run lint` runs `eslint --fix` — it mutates files. Stage your work first.

## Verify

Reproduce the CI **Validate** job (`.github/workflows/people-api.yml`) before opening a PR. There is no type-check step in CI here. From the repo root:

```bash
npm run lint -w packages/people-api   # eslint --fix (mutates files — stage first)
npm run test -w packages/people-api   # vitest run
```

## Pointer table — when in doubt

| Doing                        | Read                                  |
| ---------------------------- | ------------------------------------- |
| Adding an endpoint / module  | `docs/architecture.md` § Module shape |
| Touching the voter data flow | `docs/data-pipeline.md`               |
| First-time setup             | `docs/getting-started.md`             |
| AI rule-by-rule code review  | `ai-rules/` (git submodule)           |

## Code style

- **No semicolons**, single quotes, trailing commas (`.prettierrc`)
- `unused-imports/no-unused-imports` is an **error**
- `@typescript-eslint/no-explicit-any` is **off** — prefer typed code anyway, treat `any` as a last resort.
- TypeScript: `strict: true`, `strictNullChecks: true`, `noImplicitAny: false`, `baseUrl: ./` so imports look like `import { X } from 'src/<feature>/...'`.
- Arrow functions over `function` declarations
- **No comments in code** unless the WHY is non-obvious

## Module shape

```
src/<feature>/
├── <feature>.module.ts
├── <feature>.controller.ts        # HTTP only — no business logic
├── services/<X>.service.ts        # extends createPrismaBase(MODELS.X) where applicable
├── schemas/<X>.schema.ts          # Zod (createZodDto)
├── utils/<X>.utils.ts             # pure helpers
└── <feature>.schema.ts            # top-level DTO schema
```

`src/people/` is the canonical reference (controller + multiple services + filter utils + Zod schemas + tests).

## PrismaBase pattern

Services backed by a Prisma model **must** extend `createPrismaBase(MODELS.ModelName)` from `src/prisma/util/prisma.util.ts`. Provides `this.model`, `this.client`, `this.logger`, and passthroughs (`findMany`, `findFirst`, `findUnique`, `count`, etc.). **Never inject `PrismaService` directly into a new service.**

`this.model`/`this.client` and the passthroughs resolve the live client through `PrismaService.instance` on every call — never cache a delegate reference, because the underlying client is rebuilt and swapped when the database URL changes (see Environment). If you must inject `PrismaService`, reach the client via `prismaService.instance`.

## Voter queries are raw SQL

Almost all `Voter` queries go through `Prisma.sql` / `$queryRaw`, not Prisma ORM CRUD. The Voter table has 100+ L2 columns and partitioning by state — the ORM path is too coarse. Filter Zod → `transformFilters` → `buildVoterFiltersSql` → `Prisma.sql` WHERE clauses → execute. Output is normalized via `transformToPersonOutput` before leaving the service.

Every `/people` count AND the filtered aggregates (`getAggregates`) run under
a 2.5s `SET LOCAL statement_timeout` (`SLOW_QUERY_TIMEOUT_MS`); on
cancellation (SQLSTATE 57014) `people.service.ts` retries once with a fenced
subquery capped at `FENCE_LIMIT` (10k), via the shared `queryWithTimeoutFence`
helper — not just name-search: a broad/low-selectivity filter can force the
same pathological `DistrictVoter` → `Voter` nested loop that a rare
name-search LIKE pattern does. The fenced count is exact when the query
completes under the timeout and a `FENCE_LIMIT` floor otherwise; the fenced
aggregates fallback computes AVG age/income over that same capped subquery, so
they become a sample rather than an exact figure when the fence binds. Every
caller of the fence — `getAggregates` and `findPeople`'s `pagination.fenced`
(ENG-10804, threaded from `rawCountForDistrict`) — carries the boolean out to
gp-api so a floored count is never presented as exact.

The voter LIST fence stays name-search-only: fencing a broad filter's list
would silently drop rows from an ordered, paginated page, whereas a count has
no ordering to preserve.

`District` and `DistrictStats` use ORM methods — they're small lookup tables.

See `docs/data-pipeline.md` for the full pipeline.

## Auth

`S2SAuthGuard` is the global `APP_GUARD`. Validates Bearer JWTs signed with `PEOPLE_API_S2S_SECRET` (shared with gp-api). Use `@Public()` to bypass (currently only `/v1/health`). `S2S_ALLOW_LOCALHOST=true` in `.env` allows unauthenticated localhost requests for dev.

## Testing

- Framework: **Vitest 4** with SWC (NestJS decorator metadata requires SWC, not esbuild)
- Test file pattern: `*.test.ts` (NOT `.spec.ts` — `nest-cli.json` has `spec: false`)
- Pattern: `Test.createTestingModule` with `useValue`/`useClass` for DI; **fakes over mocks** — reach for `vi.fn()` only for callbacks/event handlers.

## Never

- Never edit a file under `prisma/schema/migrations/<timestamp>/` — applied migrations are immutable.
- Never inject `PrismaService` directly into a new service — always extend `createPrismaBase(MODELS.X)`.
- Never expose this API publicly. It is internal-only; no end-user-facing routes.
- Never bypass `S2SAuthGuard` except via the `@Public()` decorator on health-check routes.
- Never query the `Voter` table via Prisma ORM in new code — use `Prisma.sql` / `$queryRaw`.
- Never disable `unused-imports/no-unused-imports` without an inline comment justifying it.

## Dev data coverage (QA gotcha)

The dev people-db has voter rows for **NC, DC, and WY only**. Districts in every
other state have a `DistrictStats` row but zero `DistrictVoter` rows, so
unfiltered counts (stats shortcut) look healthy while ANY filter returns 0 —
people-api logs a structured warning when a zero filtered count hits such a
district (ENG-10745). QA of contacts filters on dev must use an org whose
district resolves to NC/DC/WY, or set `organization.override_district_id`
(gp-api dev DB) to a loaded district, e.g. CHEYENNE CITY
`c6b12896-93cb-b360-221f-ca61318afe43`.

## Environment

- Node `v22.12` (`.nvmrc`)
- npm
- Postgres for local dev. The DB needs `green` and `public` schemas (`schemas = ["green", "public"]` in `prisma/schema/schema.prisma`); `npm run migrate:dev` creates them.
- Required env vars: `LOCAL_DATABASE_URL`, `PEOPLE_API_S2S_SECRET`, `PORT` (code default 3000; `.env.example` sets 3002), `S2S_ALLOW_LOCALHOST` (dev only). See `.env.example`.
- **Database URL:** deployed environments do **not** get a `DATABASE_URL` env var — `DatabaseUrlProvider` (`src/prisma/database-url.provider.ts`) resolves it at runtime from the SSM parameter `people-db-connection-string-<env>` (`OTEL_SERVICE_ENVIRONMENT`), revalidating every 5 min and hot-swapping the Prisma client + CSV pool when it changes (the service crashes on startup if the parameter is unreadable). Locally, and for the Prisma CLI, set `LOCAL_DATABASE_URL` instead — the provider and the schema's datasource both read it.
- `PEOPLE_STATE_ENUM` (optional, default `true`): compares `v."State"` as the `USState` enum. Set to `false` only when pointing at a cluster whose `"State"` column is plain text; the default enum comparison issues type-mismatch queries against a text column.
