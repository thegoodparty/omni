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
`VoterDownloadService`, `VoterDoorKnockingService`, `VoterPackService`,
`VoterDensityService`. Import this module to get the whole people-db surface;
don't reach for individual services from other modules directly.

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

## Every query goes through `runUnderStatementTimeout` — no exceptions

`utils/statementTimeout.util.ts` wraps a query in
`$transaction([SET LOCAL statement_timeout = '25000ms', <query>])` and maps
SQLSTATE 57014 to a `GatewayTimeoutException`. **Any new `$queryRaw` that can
touch a Voter partition goes through it.** Two deliberate exceptions, both of
which set their own timeout rather than skipping the idea:
`voterDownload.service.ts` runs a minutes-long COPY on its own pool with
`statement_timeout = 0`, and `utils/cursorScan.util.ts` uses 45s per fetch
(below).

This is not belt-and-braces on top of `socket_timeout=60`. The two do
materially different things, and the difference is the whole point:

| | `statement_timeout` (25s) | `socket_timeout` (60s) |
| --- | --- | --- |
| Who cancels | Postgres, server-side | Prisma, client-side |
| Query after firing | **killed** | **keeps running** on people-db |
| Error surfaced | `P2010 Code: 57014` | `P2010 Code: N/A`, `Timed out during query execution` |
| Maps to | classified 504 | unhandled 500 |

So an unguarded query that goes pathological burns people-db CPU for a further
**35 seconds** after the client has abandoned it — precisely the wrong
behaviour when the datastore is already the thing under stress, and
self-amplifying under retries.

Prod 2026-08-20 is the natural experiment, and is why this rule is written down
rather than left to taste. In one degradation window, on one cluster:

| endpoint | guarded? | duration | outcome |
| --- | --- | --- | --- |
| `POST /v1/chats/:id/messages` | yes | 25,011 / 25,016ms | clean 504 |
| `GET /v1/contacts/list-detail` | yes | 25,013ms | clean 504 |
| `GET /v1/door-knocking/turfs/:id/route` | **no** | **60,209ms** | **unhandled 500** |

Every guarded path died within 16ms of the 25s ceiling. The single unguarded
path — `VoterDoorKnockingService.residents()` — rode the socket timeout to 60s.
`voterDoorKnocking.service.ts` predated the timeout convention (added
2026-07-27; the guard landed 2026-07-31 in `voterQuery.service.ts` only) and was
simply never retrofitted. Note what the fix does and does not do: it makes that
failure **faster, cheaper and attributable**. It does not make it less likely.

## Never keyset-paginate a joined scan — `cursorScan.util.ts`

A result set too large to hold in memory wants pagination, and for a **joined**
scan that instinct is a trap. `voterPack.service.ts` read a district in
50,000-row pages ordered by `v."id"`, and the page predicate reached only the
`Voter` side of the merge join: nothing restricted `DistrictVoter`, so every
page re-walked the district from the start to reach its merge position. 58k DV
rows scanned on page 0, 407k on page 6 — quadratic in district size.

Measured on a 628k-row reproduction (`docs/perf/voter-pack-profile.md`):

| | keyset, 13 statements | one statement, one cursor |
| --- | ---: | ---: |
| blocks touched | 14,058,235 | 120,976 |
| read from storage | **11.5 GB** | 945 MB |
| Postgres execution | 5,389 ms | 2,072 ms |

**11.5 GB read to return a 16 MB response.** Use `scanUnderCursor` instead: one
statement, declared once, read `CURSOR_FETCH_SIZE` rows at a time. The plan
runs once, memory stays bounded, and the caller's `AbortSignal` is checked
between fetches so a scan nobody is reading stops.

Three things about it are not tuning:

- **`SET LOCAL cursor_tuple_fraction = 1`.** A cursor tells the planner a page
  will do, which is how it justifies a fast-start plan — the shape this exists
  to escape. These scans always drain.
- **45s per fetch, not 25s.** The statement clock is armed per `FETCH`, not for
  the cursor's lifetime (verified against Postgres 16), and the *first* fetch
  pays for the whole plan's startup where a keyset page paid only for its own
  slice. 45s still sits under the webapp's 90s deadline, so Postgres kills a
  pathological plan before the browser gives up on it.
- **Do not add `ORDER BY` back** unless a consumer genuinely needs order. For
  the pack nothing can observe it, and sorting a district is not free.

## The two direction columns cannot hold a direction

`Residence_Addresses_PrefixDirection` and `Residence_Addresses_SuffixDirection`
are **INTEGER** in the mirror (`prisma-people/schema/Voter.prisma`), as are their
`Mailing_` twins, while every other address component is TEXT. The L2 file spells
them `N`/`S`/`E`/`W`; the data-platform loader `try_cast`s each to `int`
(`dbt/project/models/marts/people_api/m_people_api__voter.sql`, and
`INTEGER_COLUMNS` in `write__l2_databricks_to_gp_api.py`), which in Spark yields
NULL rather than an error. **Every residence directional in people-db is
therefore NULL, silently.** Nothing in this repo can recover them.

**Do not read either column.** Anything needing a street line reads
`Residence_Addresses_AddressLine`, which is TEXT and holds the whole line,
directions included — the stop's frozen `displayAddress` and the door-knocking
unit key both do.

The cost of getting this wrong is not cosmetic. The unit key used to compose the
line from components, so with both directionals permanently empty `1234 S Main
St` and `1234 N Main St` in one ZIP keyed identically and were **one door** to
`residents()`, which merged two households' rosters. Salt Lake City is where it
is impossible to miss: the grid puts the information in the directions, so
`1234 S 5678 W` keyed — and printed on the walk sheet — as `1234 5678`.

Fixing this properly is a data-platform change (the column type, upstream). If it
ever lands, the components become usable again, but there is no reason to go
back to them: AddressLine is one column instead of five and already carries the
CASS-standardized spelling.

## Door-knocking's address-key predicate is non-sargable (latent fragility)

`residents()` filters on
`buildDoorKnockingAddressKeySql('v') = ANY($1::text[])`, where the left side is
`CONCAT_WS('|', UPPER(TRIM(COALESCE(col::text, ''))), …)` over several address
columns. That is a **computed expression, not an indexed column**, and there is
no matching expression index on the people-db mirror. Postgres therefore has to
compute the key for every row in scope and compare it against the array, so cost
scales with both the partition/district size and `addressKeys.length`.

Contrast `evaluate()` directly above it: same key in the SELECT list, but its
scan is bounded by a bbox (`buildBboxSql`) on indexed lat/long columns. It uses
the computed key for output, not to constrain the scan. `residents()` uses it to
constrain the scan, and that is the difference.

One request compiles **one** key expression, not both. A route freezes all of
its keys in a single transaction, so a `residents()` call carries either the
current three-column key or the legacy seven-column one and `residentsKeySql`
picks accordingly — a request from a route frozen since the key changed now pays
strictly less here than it used to, and one frozen before pays exactly what it
always did. Don't "simplify" that into an unconditional `OR` of the two: it would
put a second seven-column `CONCAT_WS` on every row of this scan for a branch that
is never both.

This is a **latent fragility, not a live defect**. Measured reality as of
2026-08-20: a two-second median on this endpoint, ten consecutive 200s for the
same user and turf ~19h before the incident, and exactly one 5xx in seven days.
It is best read as the reason `residents()` is the query that tips over *first*
when people-db is degraded — not a cause of routine failure.

**Do not propose an expression index on the strength of this alone.** The Voter
table is a 200M-row partitioned production mirror; an index there is a human
decision about lock behaviour and rollout, and one data point against a
two-second median does not justify it. If this endpoint's failures ever become
routine rather than a once-in-seven-days coincidence with a datastore-wide
slowdown, this is where to start, and the shape to evaluate is an expression
index matching `buildDoorKnockingAddressKeySql` exactly.

Related arithmetic worth knowing if you come back here: `residentsCap =
targetPersonIds.length * 10`, applied as `LIMIT residentsCap + 1`. The cap
bounds the *result*, never the scan — a non-matching predicate still scans the
partition regardless of how low the LIMIT is — and on a large route it is high
enough that it stops meaningfully bounding anything. It exists to reject rather
than truncate (see below), not to make the query cheap.

### Its projection is wide, and that is not the same risk

`residents()` selects eleven demographic columns (`Voter_Status`,
`Marital_Status`, `Presence_Of_Children`, `Veteran_Status`,
`Homeowner_Probability_Model`, `Business_Owner`, `Education_Of_Person`,
`Estimated_Income_Amount_Int`, `Language_Code`,
`EthnicGroups_EthnicGroup1Desc`, plus a computed
`("StateVoterID" IS NOT NULL) AS "registered"`) on top of name/age/party/phones,
so the door can show a canvasser who they are talking to.

Read that against the note above rather than as a contradiction of it. The cost
this query carries is in the **scan** — a computed key compared against an
array, with no index to probe — and the column list does not move it: every one
of these is read off a row the scan already had to visit, and the result is
bounded by `residentsCap` either way. Widening the **projection** here is
routine. Widening the **predicate**, raising the LIMIT, or softening the
reject-rather-than-truncate guard is not, and none of those changed.

`registered` is computed rather than selected raw on purpose: it is the pack's
own definition of the word (`voterPack.service.ts` derives `registered` the same
way), and it keeps a raw state voter id out of a payload with no use for one.
Note the `Person` contract's `registeredVoter` is a hardcoded `'Yes'` that reads
no column at all — don't reach for it as a model.

Display mapping is **not** duplicated here. The service calls the same exported
mappers `/v1/contacts` person detail uses
(`utils/transformToPersonOutput.util.ts`), so `Inferred Married` reaches a door
as "Likely Married" and `Completed Graduate School Likely` as "Graduate Degree",
worded identically in both products. Two of those mappers are **presence-only**
— `mapVeteranStatus` and `mapBusinessOwner` return `'Yes'` or null, because the
columns hold a value meaning yes or nothing at all — so absence is
indistinguishable from unknown and no consumer may render "No" for them. The one
deliberate departure is `language`: `mapLanguage` returns `'Other'` for an
absent value, which is right for a CSV column that must always have a cell and
wrong at a door, so the service keeps a null column null and only maps a present
value. That mirrors the `politicalParty` rule three lines above it.

## Reject rather than truncate — do not "fix" this into pagination

Both `evaluate()` and `residents()` deliberately fail the whole request rather
than return a partial roster, via `LIMIT cap + 1` and a `BadRequestException`
when the extra row comes back. A truncated roster sends a canvasser to the wrong
doors, which is worse than an error. Any change that silently caps, paginates or
drops residents here is a correctness regression, not a performance win.

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
| `services/voterPack.service.ts`         | Encoded voter-pack build/read                                         |
| `services/voterDensity.service.ts`      | Voter-density heat-map cells (read-only, precomputed H3 centroids)    |
| `schemas/filters.schema.ts`             | Zod filter input schema                                               |
| `utils/statementTimeout.util.ts`        | `runUnderStatementTimeout` — the 25s guard every query goes through   |
| `utils/cursorScan.util.ts`              | `scanUnderCursor` — one statement, read in chunks (never keyset a join) |
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
