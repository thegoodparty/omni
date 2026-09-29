# peopleDb

gp-api's voter engine: the filter pipeline, id `in`/`notIn`, trigram search,
stats/aggregates, CSV download and door-knocking targeting.
`ContactsService` (`src/contacts/`) and `src/doorKnocking/` call it directly.

Voter reads are served from **Databricks** — the `mart_gp_api` schema, reached
over the Statement Execution API (`databricks/`). No Prisma, no connection
pool. The services under `services/` are the module's public surface; each one
delegates to a `databricks/` service and logs the read.

The column contract is hand-maintained. `voter.types.ts` declares the `Voter`
row shape the SQL builders and column shapes in `voter.select.ts` are written
against — nothing generates it, so a column added to the mart has to be added
there before anything here can read it.

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
`list` issues a count and a page, `stats` issues a voter scan and a census
lookup, and an export issues a submit plus its chunk fetches. It is gathered
through an `AsyncLocalStorage` collector in
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

## District stats is aggregated on demand, not read from a table

`stats` computes all five dimensions from the voter rows rather than reading a
precomputed table. `buildDistrictStatsSql` is one scan:
`GROUPING SETS` emits a row per bucket per dimension plus a grand-total row from
the empty set, which is where both totals come from. Cost is roughly flat in
district size -- the scan is columnar with predicate pushdown, so fixed overhead
dominates. Measured across districts from ~1k to 23.3M constituents.

This replaced a mirrored `gp_api_district_stats` table that a pipeline refreshed
on its own cadence; rows were observed 24 and 33 days stale, so the panel showed
month-old demographics. Aggregating on demand costs latency in the tail -- a
paired comparison over 293 prod requests put the scan ~40ms behind the keyed
lookup at p50 and ~1s behind at p95 -- and that was accepted for always-current
numbers and one less pipeline dependency.

Bucket labels for education, homeowner and presenceOfChildren are **derived from
`VALUE_MAPPERS`**, not restated, so a change to the filter vocabulary cannot
leave a stats bucket labelled by the old one. Age and income are ranges rather
than a vocabulary, so their boundaries live in the builder. Income labels use an
en dash, which is what the product renders.

An age below the ranges buckets as `Unknown`, not `51+`. The voter table's floor
is 18 today, so that arm matches nothing -- but without it a pre-registrant or a
bad age would fall through into the open-ended bucket and inflate `51+` silently,
which is the one failure mode here a reader of the numbers could not spot.

A district whose scan finds no voters maps to `null`. That absence is
load-bearing: `fetchStatsByDistrictId` turns it into `VOTER_DATA_UNAVAILABLE`,
polls gate on it, and the webapp renders a dedicated "no constituent data for
this office yet" screen rather than a zero-filled one.

`updatedAt` is the time the aggregate ran. It described a snapshot date when the
mirrored table served this, and nothing reads it, so it is a candidate for
removal from the response.

### `districtPopulation` is a second statement, not part of the scan

`findStats` also issues `buildDistrictCensusSql`, a keyed lookup against the
`gp_api_district_census_stats` mart for the district's 2020-census population.
It is a separate statement because the census figure is not a fact about voter
rows -- it counts everyone in the district, registered or not, which is the
whole reason the product shows it next to the L2 record count. The two run
concurrently under `Promise.all`, so the lookup adds no latency next to the
scan.

Three properties of that column shape the code:

- **Coverage is partial.** The mart's voter-block allocation resolves a
  population for some districts and not others, so a `null` population is a
  normal state, not an error. It renders as no row rather than an
  "Unavailable" or a zero. Never let a missing census row influence the
  `null`-vs-stats decision the voter scan alone makes -- that `null` means
  `VOTER_DATA_UNAVAILABLE`, which is a different thing entirely.
- **The value is fractional at source.** Block allocation conserves
  population mass rather than whole persons, so the column holds a real
  number. It is rounded once, here at the service boundary, so no consumer
  has to decide.
- **It is failure-isolated.** A Databricks failure on the census statement is
  caught and folded into that same `null`, because this figure must never
  fail the stats read every contacts card and polls sampling depend on.

That isolation is why the census statement deliberately bypasses `run()`:
that wrapper logs at **error** and translates into an HTTP exception, and a
swallowed failure must do neither -- an error-level line on a request that
returns 200 is an alerting hazard. It calls the client directly and logs its
own `warn`, naming the census lookup so the line is attributable to one of
the two statements. The voter scan keeps `run()` and stays exactly as loud as
every other voter read.

## The two direction columns cannot hold a direction

`Residence_Addresses_PrefixDirection` and `Residence_Addresses_SuffixDirection`
are **INTEGER** in the mart (`voter.types.ts`), as are their
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
indistinguishable from unknown and no consumer may render "No" for them.
`mapLanguage` used to be a third case, returning `'Other'` for an absent value
— at a door that told a canvasser someone speaks something other than English
or Spanish on the strength of an empty column, so the service guarded it. It
returns null for an absent value now, alongside the language filter's split of
'Other' from 'Unknown', and the guard is gone. A present but unrecognized value
is still `'Other'`.

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

All tests here are **mock-based** — nothing in this module talks to a
warehouse. `databricks*.util.test.ts` asserts the generated Spark string and
its bound parameters; the `databricks/` services are tested against a stubbed
`PeopleDbxStatementClient` (and a stubbed `fetch` for external-link chunks);
the `services/` delegates are constructed directly with a stubbed Databricks
service and a `measure`-passthrough read log. Keep new tests in this module to
that pattern — don't reach for `useTestService()` here, it boots gp-api's own
Postgres, which holds no voter data.

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
| `peopleQuery.module.ts`                         | Nest module: provides/exports all voter query services              |
| `voter.types.ts`                                | Hand-maintained `Voter` row shape + `USState`                       |
| `voter.select.ts`                               | Column shapes, incl. `DOWNLOAD_COLUMNS` (curated CSV export)        |
| `services/voterQuery.service.ts`                | List/search/person/aggregates/overlap/sample/precincts              |
| `services/voterDownload.service.ts`             | Streaming CSV export (`streamPeopleCsv`)                            |
| `services/stats.service.ts`                     | District aggregate stats, computed from the voter rows              |
| `services/electionApiDistrict.service.ts`       | District resolution/scoping, from election-api                      |
| `services/voterDoorKnocking.service.ts`         | Door-knocking cap guards + roster shaping                           |
| `services/voterPack.service.ts`                 | Encoded voter-pack build/read                                       |
| `services/voterRecommendedLists.service.ts`     | Recommended-list counts + door precinct ranking                     |
| `schemas/filters.schema.ts`                     | Zod filter input schema                                             |
| `utils/valueMappers.util.ts`                    | Wire value → the value the voter file stores                        |
| `utils/packEncoder.utils.ts`                    | Pack encoding; inverts `VALUE_MAPPERS` into pack bytes              |
| `utils/transformToPersonOutput.util.ts`         | Display mapping shared by contacts and the door                     |
| `util/hash.util.ts`                             | `personId` hash derivation (stable hash of `LALVOTERID`)            |
