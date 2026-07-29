# peopleDb

A second, **read-only** Prisma client + raw-SQL voter engine inside gp-api,
talking directly to the people-db Postgres cluster (the same `green`-schema
Voter table, 200M+ L2 records, partitioned by state, that the now-retired
`people-api` package used to serve over HTTP). This module is the in-process
replacement for that service — and the SOLE path: filter pipeline, id
`in`/`notIn`, trigram search, stats/aggregates, CSV download, and
door-knocking targeting all live here now. `ContactsService` (`src/contacts/`)
calls this module directly; the `USE_LOCAL_PEOPLE_DB` flag and the legacy
people-api HTTP/S2S client it used to fall back to are gone (see
`src/contacts/CLAUDE.md`).

## Connection: `PeopleDbUrlProvider` + `PEOPLE_DB_SSM_PARAM`

`peopleDbUrl.provider.ts` resolves the people-db connection string, in order:

1. `PEOPLE_DATABASE_URL` env var (local dev).
2. `PEOPLE_DB_SSM_PARAM` override, if set — used to point qa/preview
   environments (which don't get their own people-db cluster) at the **dev**
   people-db SSM parameter instead of the per-environment default.
3. Default: SSM parameter `people-db-connection-string-${OTEL_SERVICE_ENVIRONMENT}`.

The load is lazy and memoized (`ensureLoaded()`), not populated eagerly in
`onModuleInit` — Nest doesn't guarantee a dependency's `onModuleInit` runs
before its dependents' within the same module, so an eager read would race.
Consumers `await ensureLoaded()` themselves. It revalidates SSM every 5
minutes and notifies subscribers via `onChange()` only when the URL actually
changes; a transient SSM failure during revalidation logs and keeps serving
the last-known-good value rather than taking down a healthy process.

## Hot-swap: `PeopleDbService.instance`

`PeopleDbService` owns the live `PrismaClient` and exposes it only through
the `instance` getter — **never cache the reference**, always read through
`.instance` (or `createPeopleDbBase`'s `this.model`/`this.client`, below) so
callers follow the client across a database-URL swap. `onModuleInit` itself
is fail-soft end to end: `ensureLoaded()` + building the client are wrapped
in try/catch, logged at `debug`, and left unset on failure — a satellite
dependency (people-db) must never take down the whole gp-api monolith at
boot. `instance` throws a clear error (`people-db client not initialized —
PEOPLE_DATABASE_URL / SSM parameter is unresolved`) when the client was never
built, so misconfiguration surfaces as a request-time error, not a boot
crash. On a `PeopleDbUrlProvider` change event, `swap()` builds a fresh
client, atomically repoints `instance` to it, and fire-and-forgets
`$disconnect()` on the old client (drains in-flight queries; a failed
teardown of the old client must never disturb the new one) — this is also
what recovers a never-initialized client once the URL becomes resolvable.
Each built client sets `connection_limit=25`, `pool_timeout=5`,
`connect_timeout=5`, `socket_timeout=60` on the connection URL. Initial
`$connect()` within `buildClient` is separately fail-soft: a broken
`PEOPLE_DATABASE_URL` logs and moves on rather than throwing, so Prisma can
reconnect lazily on the first real query.

## `createPeopleDbBase` — the PrismaBase equivalent

`peopleDbBase.util.ts` mirrors gp-api's `createPrismaBase(MODELS.X)` pattern
for this second client: `createPeopleDbBase(PEOPLE_MODELS.Voter)` gives a
service `this.model` / `this.client` plus passthrough methods (`findMany`,
`findFirst`, `findFirstOrThrow`, `findUnique`, `findUniqueOrThrow`, `count`).
Those passthroughs are rebound on every `onModuleInit`, resolving `this.model`
fresh each call rather than binding once — a one-time bind would leave a
service pointed at a disconnected client after a URL swap.

## `PeopleQueryModule` exports

`peopleQuery.module.ts` provides and exports: `DistrictService`,
`StatsService`, `VoterSampleService`, `VoterQueryService`,
`VoterDownloadService`, `VoterDoorKnockingService`. Import this module to get
the whole people-db surface; don't reach for individual services from other
modules directly.

## The state-literal partition-pruning invariant

`utils/buildVoterWhereSql.util.ts`'s `stateEquals()` inlines the US state code
as a **SQL literal**, never a bound parameter, in any join/filter comparing
`v."State"` against the Voter table. A parameterized (or cast-of-a-bind)
state breaks equivalence-class constant propagation across
`v."State" = dv."State"` joins, so the planner falls back to a seq-scan of
the entire state partition + hash join instead of a nested-loop index probe
(~7.5s vs ~1.3s on a large district). This is safe because state is checked
against the fixed `USState` enum allowlist before being spliced in via
`Prisma.raw`, never sourced from raw user input. **Do not "clean up" this
inlining into a parameterized query** — it's a deliberate, measured
perf-critical invariant, not an oversight. `PEOPLE_STATE_ENUM=false` switches
the comparison to plain text for loader-built (non-Prisma-managed) clusters;
the default keeps the `"public"."USState"` cast.

## Testing

All tests here are **mock-based** — there is no people-db test container in
this project (a live-DB integration tier was scoped out). Prisma client
construction is mocked (see `peopleDb.service.test.ts`'s `vi.mock('../generated/people-prisma', ...)`
pattern); SQL-builder utils assert the generated SQL string + params
(`filters.sql.util.test.ts` pattern) rather than executing against Postgres.
Keep new tests in this module to that pattern — don't reach for
`useTestService()` here, it boots gp-api's own Postgres, not people-db.

## Key files

| Path                                    | Purpose                                                               |
| --------------------------------------- | --------------------------------------------------------------------- |
| `peopleDbUrl.provider.ts`               | SSM-backed connection-string resolution + change notification         |
| `peopleDb.service.ts`                   | Owns the live Prisma client; hot-swap on URL change                   |
| `peopleDbBase.util.ts`                  | `createPeopleDbBase` — PrismaBase equivalent for this client          |
| `peopleQuery.module.ts`                 | Nest module: provides/exports all people-db query services            |
| `voter.select.ts`                       | Prisma `select` shapes, incl. `DOWNLOAD_COLUMNS` (curated CSV export) |
| `services/voterQuery.service.ts`        | List/search/count (`findPeople`), filter pipeline                     |
| `services/voterDownload.service.ts`     | Streaming CSV export (`streamPeopleCsv`)                              |
| `services/stats.service.ts`             | District aggregate stats                                              |
| `services/district.service.ts`          | District resolution/scoping                                           |
| `services/voterSample.service.ts`       | Sample rows (for preview/testing scenarios)                           |
| `services/voterDoorKnocking.service.ts` | Door-knocking target resolution                                       |
| `schemas/filters.schema.ts`             | Zod filter input schema                                               |
| `utils/filters.sql.util.ts`             | `buildVoterFiltersSql` — filter → SQL translation, incl. id-set cap   |
| `utils/buildVoterWhereSql.util.ts`      | WHERE-clause SQL builders, incl. `stateEquals`                        |
| `utils/buildAggregatesSql.util.ts`      | Aggregate/stats SQL builders                                          |
| `utils/resolveDistrict.util.ts`         | District join/resolution helper                                       |
| `util/hash.util.ts`                     | `personId` hash derivation (stable hash of `LALVOTERID`)              |
