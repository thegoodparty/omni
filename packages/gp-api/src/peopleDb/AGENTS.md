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
the last-known-good value rather than taking down a healthy process. The
revalidation interval is scheduled even when the first load **fails** —
consumers' `onModuleInit` is the only guaranteed caller of `ensureLoaded()`,
so without that a failed boot load would never be retried and every people-db
request would 500 until a task restart (the 2026-07-29 prod contacts outage;
the trigger was a missing IAM grant, see `deploy/CLAUDE.md` § People-db
connection string).

## Hot-swap: `PeopleDbService.instance`

`PeopleDbService` owns the live `PrismaClient` and exposes it only through
the `instance` getter — **never cache the reference**, always read through
`.instance` (or `createPeopleDbBase`'s `this.model`/`this.client`, below) so
callers follow the client across a database-URL swap. `onModuleInit` itself
is fail-soft end to end: `ensureLoaded()` + building the client are wrapped
in try/catch, logged at `warn`, and left unset on failure — a satellite
dependency (people-db) must never take down the whole gp-api monolith at
boot. `instance` throws a clear error (`people-db client not initialized —
PEOPLE_DATABASE_URL / SSM parameter is unresolved`) when the client was never
built, so misconfiguration surfaces as a request-time error, not a boot
crash. On a `PeopleDbUrlProvider` change event, `swap()` builds a fresh
client, atomically repoints `instance` to it, and fire-and-forgets
`$disconnect()` on the old client (drains in-flight queries; a failed
teardown of the old client must never disturb the new one) — this is also
what recovers a never-initialized client once the URL becomes resolvable.
Each built client sets `connection_limit=50`, `pool_timeout=5`,
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

## `plan_cache_mode=force_custom_plan` — do not remove it

`buildClient` appends `options=-c plan_cache_mode=force_custom_plan` to the
connection URL. This is load-bearing, not tuning.

Every filter value in `filters.sql.util.ts` is a **bound parameter**. Postgres
plans a prepared statement custom for its first 5 executions, then may switch to
a generic plan built without knowing the values. For a range filter it then
assumes default selectivity and **inverts the join**: instead of driving from
`DistrictVoter` for the one district, it bitmap-scans every voter in the state's
age/income band (~116k estimated rows) and checks district membership after.

Measured on prod 2026-08-16, a 7,828-voter district with an age + income range,
through the real Prisma client:

| execution | without the option | with it |
| --------- | ------------------ | ------- |
| 1–5       | ~140ms             | ~140ms  |
| 6+        | **~17,700ms**      | ~150ms  |

That ~130x cliff blew the 25s statement timeout and was the mechanism behind the
`GET /v1/contacts/list-detail` 504s. It reads as intermittent because it depends
on how many times a **pooled** connection has run that statement shape, so a
fresh connection looks fine and a well-used one times out. It also inverts the
usual cache intuition — the first hit is fast and later ones are slow — which is
why it hid inside the benchmark's warm p95.

Two traps when touching this:

- **`psql` with inlined literals cannot reproduce it.** A literal always gets a
  custom plan. Reproduce through Prisma (or `PREPARE`/`EXECUTE` 6+ times).
- **Do not set it via `url.searchParams.set`.** `URLSearchParams` encodes the
  space in `-c plan_cache_mode=...` as `+`, which libpq does not decode back to
  a space; the option is then silently ignored and the cliff returns with
  nothing to show it. It is written by hand with `%20` for this reason, and
  `peopleDb.service.test.ts` asserts the encoding.

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

## Benchmarks

Query performance here is benchmarked by the in-process suite in
`perf/people-db/` (latency matrix + concurrency load mode against a real
people-db). If you add or change a query method on one of the services above,
add or adjust a case so it stays covered: a new query type needs a branch in
`perf/people-db/harness.ts`'s `invoke` and cases in `perf/people-db/cases.ts`;
a new filter shape worth measuring is a `FilterVariant` in
`perf/people-db/filterVariants.ts`. See `perf/people-db/CLAUDE.md`.
