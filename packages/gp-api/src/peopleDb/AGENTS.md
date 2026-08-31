# peopleDb

gp-api's voter engine: the filter pipeline, id `in`/`notIn`, trigram search,
stats/aggregates, CSV download, door-knocking targeting, and the voter-density
heat map. `ContactsService` (`src/contacts/`) and `src/doorKnocking/` call it
directly.

Voter reads are served from **Databricks** — the `mart_gp_api` schema, reached
over the Statement Execution API (`databricks/`). No Prisma, no connection
pool. The services under `services/` are the module's public surface; each one
delegates to a `databricks/` service and logs the read.

One read is the exception. `VoterDensityService` reads the precomputed H3
heat-map table through a second, read-only Prisma client against people-db
Postgres, because `mart_gp_api` holds no density table and this cannot move
until the data platform publishes one. Everything below about connection
handling, the client hot-swap and `createPeopleDbBase` exists for that one
read.

## Every voter read emits one log line

`databricks/voterReadLog.service.ts` wraps each read: it times the Databricks
call, collects the statement ids it issued, and emits one flat
`people-db voter read` line at a stable message so a LogQL query can aggregate
a window of them. Flat rather than nested because LogQL cannot unwrap nested
json without a parser expression per field.

| field          |                                                    |
| -------------- | -------------------------------------------------- |
| `op`           | which read (table below)                           |
| `districtId`   | the district the read was scoped to                |
| `dbxMs`        | wall-clock ms for the whole operation              |
| `statementIds` | every Databricks statement id the operation issued |

`statementIds` is an array, not a scalar, and is collected **per operation**:
`list` issues a count and a page, and an export issues a submit plus its chunk
fetches. It is gathered through an `AsyncLocalStorage` collector in
`databricks/peopleDbxStatement.client.ts`, which is what lets the client push
an id without the read path threading one back. It is the join key for
warehouse-side latency attribution (statement duration, queue time, cold
starts), so a new read path that bypasses the client will log an empty array
and silently drop out of that analysis.

A failed read still logs the line, at `warn` with the error attached: a
statement that timed out is exactly the sample a cold-start attribution needs,
and dropping it would bias the measurement toward reads that were already
fast. Voter data has one store, so a warehouse failure propagates rather than
degrading to a second answer.

| `op`                                                                                            | served by                          | called from                    |
| ----------------------------------------------------------------------------------------------- | ---------------------------------- | ------------------------------ |
| `list`, `voter-by-id`, `aggregates`, `list-detail-aggregates`, `overlap`, `sample`, `precincts` | `DatabricksVoterService`           | `voterQuery.service.ts`        |
| `stats`                                                                                         | `DatabricksVoterService.findStats` | `stats.service.ts`             |
| `dk-evaluate`, `dk-residents`                                                                   | `DatabricksVoterService`           | `voterDoorKnocking.service.ts` |
| `dk-pack`                                                                                       | `DatabricksVoterPackService`       | `voterPack.service.ts`         |

The CSV download (`voterDownload.service.ts`) emits no line. An export is a
stream measured in minutes and gigabytes, so a single elapsed number does not
describe it, and the statement ids worth attributing are its chunk fetches
rather than one submit.

`list-detail-aggregates` answers everything `GET /v1/contacts/list-detail`
needs in one statement: the demographics `COUNT`/`AVG`s with a `COUNT_IF` per
reachability channel beside them.

## Connection: `PeopleDbUrlProvider` + `PEOPLE_DB_SSM_PARAM`

`peopleDbUrl.provider.ts` resolves the people-db connection string, in order:

1. `PEOPLE_DATABASE_URL` env var (local dev).
2. `PEOPLE_DB_SSM_PARAM` override, if set — used to point preview
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

## `plan_cache_mode=force_custom_plan` — do not remove it

`buildClient` appends `options=-c plan_cache_mode=force_custom_plan` to the
connection URL. Postgres plans a prepared statement custom for its first few
executions, then may switch to a generic plan built without knowing the bound
values; for a selective predicate that generic plan can be catastrophically
wrong, and it reads as intermittent because it depends on how many times a
**pooled** connection has run that statement shape.

Two traps when touching it:

- **`psql` with inlined literals cannot reproduce the effect.** A literal
  always gets a custom plan. Reproduce through Prisma (or `PREPARE`/`EXECUTE`
  enough times to cross the threshold).
- **Do not set it via `url.searchParams.set`.** `URLSearchParams` encodes the
  space in `-c plan_cache_mode=...` as `+`, which libpq does not decode back to
  a space; the option is then silently ignored with nothing to show it. It is
  written by hand with `%20` for this reason, and `peopleDb.service.test.ts`
  asserts the encoding.

## The two direction columns cannot hold a direction

`Residence_Addresses_PrefixDirection` and `Residence_Addresses_SuffixDirection`
are **INTEGER** in the mirror (`prisma-people/schema/Voter.prisma`), as are their
`Mailing_` twins, while every other address component is TEXT. The L2 file spells
them `N`/`S`/`E`/`W`; the data-platform loader `try_cast`s each to `int`
(`dbt/project/models/marts/people_api/m_people_api__voter.sql`, and
`INTEGER_COLUMNS` in `write__l2_databricks_to_gp_api.py`), which in Spark yields
NULL rather than an error. **Every residence directional is therefore NULL,
silently.** Nothing in this repo can recover them.

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

## Door knocking: the query returns rows, the shaping happens here

`databricksVoterSql.util.ts` produces **rows**; the cap check and the roster
shaping happen in module-level functions in `voterDoorKnocking.service.ts`.
That placement is deliberate and the one thing to preserve if you touch this:
the reject-rather-than-truncate rule below is a correctness invariant, not a
query implementation detail, and it belongs beside the shaping rather than
inside whatever produced the rows.

The pieces of the key that must agree across producers come from
`@goodparty_org/contracts` (`DOOR_KNOCKING_UNIT_KEY_COLUMNS`, its legacy twin,
and `HOUSEHOLD_KEY_RESIDENCE_COLUMNS`), so a key composed when a route was
frozen matches one composed now. Spark needs an explicit `cast(... AS STRING)`
inside the `coalesce`: the two direction columns are INT (above) and Spark will
not coalesce an INT with `''`.

A route freezes all of its keys in one transaction, so a `residents()` request
carries either the current three-column key or the legacy seven-column one, and
the query selects the matching key expression rather than OR-ing both. The
projection matters as much as the predicate: callers look their own stored keys
up in the result, so a legacy request has to come back keyed the legacy way —
return the current key for it and every address silently misses, which reads at
the door as the whole route having moved away.

The pack is the one read that does not use the inline path.
`PeopleDbxStatementClient.query()` accumulates every chunk before returning,
which for a whole district is an unbounded materialization, so
`DatabricksVoterPackService` reads CSV through external links and parses one
chunk at a time into the encoder.

### The resident projection is wide, and that is deliberate

`residents()` returns eleven demographic columns (`Voter_Status`,
`Marital_Status`, `Presence_Of_Children`, `Veteran_Status`,
`Homeowner_Probability_Model`, `Business_Owner`, `Education_Of_Person`,
`Estimated_Income_Amount_Int`, `Language_Code`,
`EthnicGroups_EthnicGroup1Desc`, plus a computed
`("StateVoterID" IS NOT NULL) AS "registered"`) on top of name/age/party/phones,
so the door can show a canvasser who they are talking to.

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

Related arithmetic worth knowing: `residentsCap = targetPersonIds.length * 10`,
applied as `LIMIT residentsCap + 1`. The cap bounds the _result_, never the
scan. It exists to reject rather than truncate, not to make the query cheap.

## Testing

All tests here are **mock-based** — there is no people-db test container in
this project, and nothing here talks to a warehouse. `databricks*.util.test.ts`
asserts the generated Spark string and its bound parameters; the `databricks/`
services are tested against a stubbed `PeopleDbxStatementClient` (and a stubbed
`fetch` for external-link chunks); the `services/` delegates are constructed
directly with a stubbed Databricks service and a `measure`-passthrough read
log. Prisma client construction is mocked for the density read (see
`peopleDb.service.test.ts`'s `vi.mock('../generated/people-prisma', ...)`
pattern). Keep new tests in this module to that pattern — don't reach for
`useTestService()` here, it boots gp-api's own Postgres, not people-db.

Route-level coverage lives with the routes (`src/contacts/tests/`,
`src/voters/`, `src/doorKnocking/`), where tests spy on the `services/` methods
by name. Those spies are the reason the delegate classes keep their names and
signatures rather than callers reaching into `databricks/` directly.

## Key files

| Path                                            | Purpose                                                             |
| ----------------------------------------------- | ------------------------------------------------------------------- |
| `databricks/voterReadLog.service.ts`            | Times each read and emits the `people-db voter read` line           |
| `databricks/peopleDbx.config.ts`                | `PEOPLE_DATABRICKS_*` resolution; catalog/schema/hostname constants |
| `databricks/peopleDbxStatement.client.ts`       | Statement Execution API: inline JSON, CSV external links, polling   |
| `databricks/databricksVoterSql.util.ts`         | Spark SQL builders + the bound-parameter/inlining rules             |
| `databricks/databricksVoter.service.ts`         | List/person/aggregates/stats/sample/precincts + door-knocking rows  |
| `databricks/databricksVoterDownload.service.ts` | Streaming CSV export over external links                            |
| `databricks/databricksVoterPack.service.ts`     | Voter pack built from CSV chunks (never the inline path)            |
| `peopleDbUrl.provider.ts`                       | SSM-backed connection-string resolution + change notification       |
| `peopleDb.service.ts`                           | Owns the live Prisma client; hot-swap on URL change                 |
| `peopleDbBase.util.ts`                          | `createPeopleDbBase` — PrismaBase equivalent for this client        |
| `peopleQuery.module.ts`                         | Nest module: provides/exports all people-db query services          |
| `voter.select.ts`                               | Column shapes, incl. `DOWNLOAD_COLUMNS` (curated CSV export)        |
| `services/voterQuery.service.ts`                | List/search/person/aggregates/overlap/sample/precincts              |
| `services/voterDownload.service.ts`             | Streaming CSV export (`streamPeopleCsv`)                            |
| `services/stats.service.ts`                     | District aggregate stats                                            |
| `services/electionApiDistrict.service.ts`       | District resolution/scoping, from election-api                      |
| `services/voterDoorKnocking.service.ts`         | Door-knocking cap guards + roster shaping                           |
| `services/voterPack.service.ts`                 | Encoded voter-pack build/read                                       |
| `services/voterDensity.service.ts`              | Voter-density heat-map cells (read-only, precomputed H3 centroids)  |
| `schemas/filters.schema.ts`                     | Zod filter input schema                                             |
| `utils/valueMappers.util.ts`                    | Wire value → the value the voter file stores                        |
| `utils/packEncoder.utils.ts`                    | Pack encoding; inverts `VALUE_MAPPERS` into pack bytes              |
| `utils/transformToPersonOutput.util.ts`         | Display mapping shared by contacts and the door                     |
| `util/hash.util.ts`                             | `personId` hash derivation (stable hash of `LALVOTERID`)            |
