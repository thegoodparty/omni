# peopleDb

A second, **read-only** Prisma client + raw-SQL voter engine inside gp-api,
talking directly to the people-db Postgres cluster (the same `green`-schema
Voter table, hundreds of millions of L2 records, partitioned by state, that the now-retired
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
plans a prepared statement custom for its first five executions, then may switch
to a generic plan built without knowing the values. For a range filter it then
assumes default selectivity and **inverts the join**: instead of driving from
`DistrictVoter` for the one district, it bitmap-scans every voter in the state's
age/income band and checks district membership after.

Without the option, the sixth and later executions of that statement shape run
**orders of magnitude slower than the first five** — enough to blow the 25s
statement timeout on a district small enough to be fast otherwise, which was the
mechanism behind the `GET /v1/contacts/list-detail` 504s. With it, every
execution stays at the fast plan.

It reads as intermittent because it depends on how many times a **pooled**
connection has run that statement shape, so a fresh connection looks fine and a
well-used one times out. It also inverts the usual cache intuition — the first
hit is fast and later ones are slow — which is why it hid inside the benchmark's
warm p95.

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
touch a Voter partition goes through it.** The one deliberate exception is
`voterDownload.service.ts`, which runs a minutes-long COPY on its own pool and
sets `statement_timeout = 0` explicitly.

This is not belt-and-braces on top of `socket_timeout=60`. The two do
materially different things, and the difference is the whole point:

| | `statement_timeout` (25s) | `socket_timeout` (60s) |
| --- | --- | --- |
| Who cancels | Postgres, server-side | Prisma, client-side |
| Query after firing | **killed** | **keeps running** on people-db |
| Error surfaced | `P2010 Code: 57014` | `P2010 Code: N/A`, `Timed out during query execution` |
| Maps to | classified 504 | unhandled 500 |

So an unguarded query that goes pathological keeps burning people-db CPU after
the client has abandoned it — for the difference between the two timeouts,
precisely the wrong behaviour when the datastore is already the thing under
stress, and self-amplifying under retries.

Prod 2026-08-20 is the natural experiment, and is why this rule is written down
rather than left to taste. In one degradation window, on one cluster, every
guarded path (`POST /v1/chats/:id/messages`, `GET /v1/contacts/list-detail`)
died within milliseconds of the 25s ceiling as a clean 504, while the single
unguarded path — `VoterDoorKnockingService.residents()` — rode the socket
timeout all the way out and surfaced as an unhandled 500.
`voterDoorKnocking.service.ts` predated the timeout convention (added
2026-07-27; the guard landed 2026-07-31 in `voterQuery.service.ts` only) and was
simply never retrofitted. Note what the fix does and does not do: it makes that
failure **faster, cheaper and attributable**. It does not make it less likely.

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

This is a **latent fragility, not a live defect**. As of 2026-08-20 the endpoint
was healthy in normal operation — a low single-digit-second median, and 5xxs
rare enough over a week to be coincidental rather than routine. It is best read
as the reason `residents()` is the query that tips over *first* when people-db is
degraded, not as a cause of routine failure.

**Do not propose an expression index on the strength of this alone.** The Voter
table is a large partitioned production mirror; an index there is a human
decision about lock behaviour and rollout, and one data point against a healthy
median does not justify it. If this endpoint's failures ever become
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
the entire state partition + hash join instead of a nested-loop index probe,
which is several times slower on a large district. This is safe because state is
checked
against the fixed `USState` enum allowlist before being spliced in via
`Prisma.raw`, never sourced from raw user input. **Do not "clean up" this
inlining into a parameterized query** — it's a deliberate, measured
perf-critical invariant, not an oversight. `PEOPLE_STATE_ENUM=false` switches
the comparison to plain text for loader-built (non-Prisma-managed) clusters;
the default keeps the `"public"."USState"` cast.

## Databricks is where voter data comes from

`databricks/` serves the voter queries: aggregates, list/search, saved-list
overlap, district stats and the CSV export. There is no runtime store
selection — no flag, no fallback. `VoterQueryService`, `StatsService` and
`VoterDownloadService` keep their interfaces, so callers, contracts and the
`perf/people-db/` benchmark suite are unchanged.

It queries `goodparty_data_catalog.dbt` (the dbt-modelled mirror of the same L2
data) through the Statement Execution API, using the `PEOPLE_DATABRICKS_*`
credential — its own service principal (`sp_people_db`) on its own dedicated
warehouse, so voter scans never queue behind interactive chat. **Never the
`DATABRICKS_*` (Serve) or `WIN_DATABRICKS_*` (Campaign Manager) credentials**:
grants are per principal and those are scoped to their own marts.

That principal's grant is least-privilege and covers exactly two tables,
`m_people_api__voter` and `m_people_api__district`. Naming any other table in a
query is a permission error in production, which is what
`databricksVoterSql.util.test.ts`'s grant test pins.

If `PEOPLE_DATABRICKS_*` is unset or the credential is rejected, voter queries
fail (see below) — there is nothing to fall back to.

**What people-db still serves.** Five surfaces have no Databricks
implementation yet and still read the Postgres mirror, which is why
`PeopleDbService`, `peopleDbUrl.provider.ts`, `createPeopleDbBase` and the
people-Prisma client are all still here:

| Surface | Why it has not moved |
| --- | --- |
| `findPeople` with `groupByHousehold` | `DISTINCT ON` household de-dup has no direct equivalent |
| CSV export with `groupByHousehold` | same de-dup, in the COPY projection |
| `findPerson` | single-row lookup, not yet ported |
| `VoterSampleService` | hash-bucket sampling over the id space |
| `VoterDoorKnockingService`, `VoterPackService` | bbox scans and the address-key predicate |

Porting those is the next piece of work, and until it lands the Postgres
connection cannot be removed. One cross-store read is deliberate:
`VoterSampleService` samples from Postgres but sizes its buckets from
`StatsService.findTotalCounts`, which now computes from Databricks. The two
agree on those totals, and it is what preserves the `VOTER_DATA_UNAVAILABLE`
throw for a district with no voters.

### Failing without a fallback

Because there is no second store, an unreachable warehouse is a hard failure —
and it must not be confusable with an empty district, because a district with no
voters is a MEANINGFUL null that the product renders as "no constituent data for
this office yet". So every way of failing to reach Databricks (missing
credential, expired or under-granted token, 401/403/429/5xx from the API, a
failed token exchange) raises `PeopleDbxUnavailableError`, which the callers
translate to **502** with the reason logged. A statement over the byte ceiling
is a **400** (the caller's selection is too large), and a statement past the
time ceiling is a **504**. None of those can present as zero voters.

### Wide-column district scoping — never the junction table

Postgres scopes a district by joining `green."DistrictVoter"`. **Do not port
that join.** The membership table's Databricks equivalent is clustered by voter
id rather than district, so a district predicate prunes nothing in it and its
cost is insensitive to district size — and it is outside this principal's grant
anyway. `buildScopeSql` instead filters the voter row's own L2 district column:
`m_people_api__district` gives `(id, state, type, name)` where **`type` IS the
voter column name and `name` is its value**, so a district becomes
``WHERE `State` = 'CA' AND `US_Congressional_District` = '29'``.

Two things were verified before relying on this, both re-runnable: wide-column
scoping selects the same population as membership-table scoping, checked on the
benchmark cohorts across three orders of magnitude of district size; and every
`type` value in the district catalog is a real column on the voter table, so
every district is addressable this way with none falling back.

The `State` predicate stays on every query: the voter table is liquid-clustered
by `State`, and that is what prunes. The `useVoterOnlyPath` special case carries
over unchanged — a `State` district whose name is the state has no membership
rows at all, so it scopes on `State` alone.

### `DistrictStats` is computed, not read

The mirrored stats table lags the voter data by days at a time, so
`databricksDistrictStatsSql.util.ts` recomputes the whole row on demand — one
scan, a `count_if` per bucket label. That costs little over a single-row lookup
and stays roughly flat across district sizes, which is what makes reading a
stale table not worth it. It is also outside this principal's grant.

Verified exact against the mirrored stats table on all four benchmark cohorts:
same totals, same cell-phone count, same labels, counts, percents and ordering.
Note that mirror lowercases its JSON keys (`estimatedincomerange`), while the
shape gp-api and the webapp consume is camelCase (`estimatedIncomeRange`) — one
more reason not to read it.

Two things there are load-bearing:

- **A zero-voter district must map back to `null`.** "No stats row" is product
  behavior, not an absence of data: `polls.controller.ts` gates poll creation on
  `totalConstituentsWithCellPhone`, `computeHashDivisorAndPrelimit` and
  `fetchStatsByDistrictId` throw `VOTER_DATA_UNAVAILABLE` on null, and the
  webapp renders a dedicated "no constituent data for this office yet" screen
  keyed on that code. An on-demand query returns 0, never null, so
  `mapDistrictStatsRow` does the mapping.
- **`'Probable Home Owner'` folds into `Yes`**, and there is no `Likely`
  bucket. That deliberately disagrees with `VALUE_MAPPERS.homeowner` in
  `filters.sql.util.ts`, which maps the same value to `Likely`. The
  inconsistency between the stats table and the filter pipeline predates this
  code; reproducing the stats-table behavior is what keeps these numbers
  identical to the ones the product shows today.

### Name search uses `lower(col) LIKE`, not `isearch()`

`isearch()` works and is equally fast, but its only documentation sits inside a
Beta feature page, so we take no dependency on it. The tokenizer is a
character-for-character port of `buildVoterWhereSql`'s search branch — phone
normalization, 3+ char infix vs 1-2 char prefix, LIKE-metacharacter escaping —
so a search resolves to the same match set in both stores.

### CSV export mechanics

`databricksVoterDownload.service.ts` uses `disposition: EXTERNAL_LINKS` with
`format: CSV`, never the `@databricks/sql` driver's `fetchChunk` (which
materializes every row through Thrift and is far slower). Four things verified
against the real 76-column projection:

- `SUCCEEDED` means the chunk **plan** is ready, not that bytes are written —
  chunks materialize lazily on fetch, which is what lets a large download start
  streaming within seconds instead of after the whole export.
- The first response carries **only chunk 0's link**; the rest arrive one at a
  time via `next_chunk_internal_link`. Presigned links carry a short TTL
  (~15 minutes at the time of writing), so a long export re-requests them
  mid-stream rather than resolving the chain up front.
- **Chunk 0 carries the CSV header row and later chunks do not**, so aliasing
  each column to its `DOWNLOAD_COLUMNS` header gives the curated header for
  free.
- **Every column is `nvl(CAST(col AS STRING), '')`.** The API renders a SQL
  NULL as the literal text `null` in CSV where Postgres `COPY` writes an empty
  field — without the coalesce the download is full of the word "null".

### Id sets are inlined, and 16 MiB is a hard ceiling

The Statement Execution API has no array parameter type, so an id set is
inlined as literals where the Postgres path binds one array parameter. Measured
against the API: one set at the contract's 100k maximum is accepted inline, but
the statement field is capped at **16,777,216 bytes** (an API limit, not a
measurement), and a request carrying `filters.id` plus both id-override pairs at
that maximum exceeds it. `PeopleDbxStatementClient` therefore checks the byte
length before sending and throws `PeopleDbxStatementTooLargeError`, which the
callers translate to a 400 — it is caused by the size of the caller's selection,
not by a broken service. This is a real capability regression against the
Postgres path, which has no such ceiling.

Ids are also **lowercased** on the way in. Postgres compares them as `uuid`
(case-normalizing); here the column is `STRING` and the comparison is
byte-exact, so an uppercase id would match nothing — and an exclude set that
matches nothing silently *widens* an audience.

### Blank versus NULL: verified, not assumed

Several filters define their buckets purely as `IS NULL` / `IS NOT NULL`
(`businessOwner` most sharply: `Yes` is `IS NOT NULL`). If the dbt mirror stored
L2's blanks as `''` where the Postgres loader wrote NULL, those buckets would be
wrong with no error. Checked directly across a whole statewide cohort:
`Business_Owner`, `Language_Code`, `Marital_Status`, `Veteran_Status`,
`EthnicGroups_EthnicGroup1Desc`, `Gender`, `Voter_Status`, both phone columns and
`Residence_Addresses_AddressLine` contain **zero** empty strings. The `IS NULL`
semantics carry over unchanged.

### Timeout ceiling is 60s here, not 25s

The Postgres 25s ceiling guards against a pathological plan on a warm cluster.
On a serverless warehouse the long tail is compute startup instead, so killing
at 25s would turn every post-idle request into a 504. `PeopleDbxTimeoutError`
still maps to the same `GatewayTimeoutException`, so the 504 stays classified
and alertable.

### Blocked: the Unity Catalog grant

Neither gp-api service principal can read `goodparty_data_catalog.dbt` today —
both `DATABRICKS_*` and `WIN_DATABRICKS_*` fail with `INSUFFICIENT_PERMISSIONS:
User does not have USE SCHEMA`. The schema is owned by another service
principal, with a `data users` group holding SELECT/USE_SCHEMA. So this path can
be developed and benchmarked with a personal-identity token, but **cannot
function in dev, preview or prod until that grant is issued**. Issuing it is a
production access-control decision about restricted voter data, not a code
change.

## Testing

All tests here are **mock-based** — there is no people-db test container in
this project (a live-DB integration tier was scoped out). Prisma client
construction is mocked (see `peopleDb.service.test.ts`'s `vi.mock('../generated/people-prisma', ...)`
pattern); SQL-builder utils assert the generated SQL string + params
(`filters.sql.util.test.ts` pattern) rather than executing against Postgres.
Keep new tests in this module to that pattern — don't reach for
`useTestService()` here, it boots gp-api's own Postgres, not people-db. The
`databricks/` tests follow it too: the SQL builders assert generated SQL
strings, and the services are driven through a stubbed statement client.

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
| `utils/statementTimeout.util.ts`        | `runUnderStatementTimeout` — the 25s guard every query goes through   |
| `utils/filters.sql.util.ts`             | `buildVoterFiltersSql` — filter → SQL translation, incl. id-set cap   |
| `utils/buildVoterWhereSql.util.ts`      | WHERE-clause SQL builders, incl. `stateEquals`                        |
| `utils/buildAggregatesSql.util.ts`      | Aggregate/stats SQL builders                                          |
| `utils/resolveDistrict.util.ts`         | District join/resolution helper                                       |
| `util/hash.util.ts`                     | `personId` hash derivation (stable hash of `LALVOTERID`)              |
| `databricks/peopleDbx.config.ts`        | `PEOPLE_DATABRICKS_*` connection + warehouse resolution               |
| `databricks/peopleDbxStatement.client.ts` | Statement Execution API client (queries + CSV external links)       |
| `databricks/databricksVoterSql.util.ts` | Filter/search/scope → Databricks SQL, incl. wide-column scoping       |
| `databricks/databricksDistrictStatsSql.util.ts` | On-demand DistrictStats query + bucket mapping                |
| `databricks/databricksVoter.service.ts` | Aggregates, list/search, overlap, stats against Databricks            |
| `databricks/databricksVoterDownload.service.ts` | Streaming CSV export via EXTERNAL_LINKS chunks                |

## Benchmarks

Query performance here is benchmarked by the in-process suite in
`perf/people-db/` (latency matrix + concurrency load mode against a real
people-db). If you add or change a query method on one of the services above,
add or adjust a case so it stays covered: a new query type needs a branch in
`perf/people-db/harness.ts`'s `invoke` and cases in `perf/people-db/cases.ts`;
a new filter shape worth measuring is a `FilterVariant` in
`perf/people-db/filterVariants.ts`. See `perf/people-db/CLAUDE.md`.

The suite runs unmodified and measures whatever the services read, so on this
code it measures Databricks (except the `sample` cells, which exercise the one
remaining Postgres surface). Compare against a run of the same suite on `main`
for the before/after.
