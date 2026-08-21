# people-db benchmark suite

In-process latency + load benchmarks for the gp-api `peopleDb` services
(`src/peopleDb/`). Boots a minimal Nest context against a chosen people-db and
drives the real service methods. Design: `docs/superpowers/specs/2026-07-31-people-db-benchmark-suite-design.md`.

## Run it

MUST run with the swc-node loader (the `perf:people-db` npm script does this).
`tsx` does NOT work: esbuild drops decorator metadata and Nest DI resolves to
`undefined`.

The suite measures whatever the services read, which on this code is Databricks
for every cell except `sample` (the one remaining people-db Postgres surface).
For a before/after, run the same suite on `main` and on this branch.

```bash
# Needs the PEOPLE_DATABRICKS_* credentials the peopleDb client reads (see
# src/peopleDb/AGENTS.md). The `sample` cells additionally need
# PEOPLE_DATABASE_URL — they are the one query type still reading people-db, and
# they error without it while every other cell runs. prod requires the VPN for
# those.
export PEOPLE_DATABASE_URL='<connection-string>'   # for `sample` cells only

npm run perf:people-db -- --mode=latency --env=prod
npm run perf:people-db -- --mode=load --env=dev   # concurrency sweep + gate
npm run perf:people-db -- --smoke --env=dev       # one case, boot check
```

Results print as a table and are written to
`scripts/output/people-db-bench-<env>-<store>-<sha>-<mode>.json`, plus a
fixed-format HTML page beside it (`.html`) rendered by `artifactHtml.ts`.

The HTML page is the reporting surface: publish it as a Claude artifact. Its
format is deliberately constant (provenance, results table, failures, then one
description table per axis) and carries **no generated prose** — every word is
either boilerplate in `artifactHtml.ts` or a `description` string carried in the
JSON. Interpretation goes in the chat reply, never on the page. Re-render an
older JSON with `npm run perf:people-db:html -- <path>`. The end-to-end
procedure lives in the `run-people-db-benchmark` skill.

`load` mode adds real pool contention; run against prod (`--env=prod`) only
off-peak. It exits non-zero if any scenario's error rate at the target
concurrency (50, the `connection_limit`) is above its budget.

Budgets are **per scenario**. The `large` scenarios carry `maxErrorRate: 1`
(observation-only): when that band's cold run is over the statement timeout
single-shot, every request at c=50 is cold at once, so a 0 budget would make
`FAIL` the permanent baseline instead of a regression signal. They still record
numbers in the artifact — they just can't red the gate. Tighten them once a load
pass gives a measured error rate to calibrate against. At least one scenario
must keep a 0 budget or the gate is decorative.

## Cohort bands are NOT ordered by cost

Bands are `small` / `medium` / `large` / `mega` / `statewide`, each pinned to one
real district in `cohorts.ts` (which carries the membership each band was picked
for, and `checkDrift` warns when a district leaves its band). The names describe
**district membership**, which turns out to be a poor predictor of query time.
Two things dominate it instead:

**1. Whether the query joins at all.** `resolveDistrict.util.ts` sets
`useVoterOnlyPath` when a district's type is `State` and its name matches the
state. That nulls the `districtId`, so the query becomes a single
partition-pruned scan of `Voter` with **no `DistrictVoter` join**. `statewide`
is therefore the cheapest per row, not the most expensive — treat it as the
no-join control.

**2. Which state partition it probes.** The join is a nested loop: one index
probe into `Voter_<STATE>` per district member. Cost is dominated by how
resident that partition is, not how many members the district has.

`large` (a CA congressional district) and `mega` (a FL county) are the pair that
makes this visible: `mega` has substantially more members but sits in a smaller,
more resident state partition, and it can run faster than `large` by an order of
magnitude. `mega` was added 2026-08-16 as the suite's **first non-CA cohort**
for exactly that reason — every other band is a California district, so before
it the suite could not tell a district-size regression from a state-partition
one. It is also the cohort behind most of one week's
`GET /v1/contacts/list-detail` 504s while benchmarking fine single-shot, which
points at contention or cold cache rather than a slow plan. That is what
`load:count:mega` is for.

Which cell is slowest, and whether a band's cold run exceeds the statement
timeout, both move with the cluster — so `count:large:*` reporting failures may
be the standing baseline rather than a regression. **Run the suite and read the
current artifact before concluding anything about relative cost**; that is what
it is for, and it is the only non-stale source for these numbers.

## Add a benchmark when you add a query

If you add or change a query method on a `peopleDb` service, add or adjust a
case here so it stays covered:

1. New filter shape worth measuring -> add a `FilterVariant` in `filterVariants.ts`.
2. New query method -> add a `QueryType` and a branch in `harness.ts`'s `invoke`,
   then emit cases for it in `cases.ts` (`buildLatencyCases`).
3. New concurrency concern -> add a `LoadScenario` in `loadScenarios.ts`.
4. New cohort band -> also add it to `BAND_ORDER` in `report.ts`, and a new
   variant to `VARIANT_ORDER`. Both lists are hardcoded and the matrix silently
   **drops** anything missing from them, so the cases run and never print.
5. Re-pin cohorts if `checkDrift` warns (re-run the discovery SQL in the plan).

Every axis carries a human-language `description` and they are **not optional**:
`FilterVariant.description`, `QUERY_DESCRIPTIONS` in `cases.ts`, and
`Cohort.description`/`district`/`partition`. `buildArtifact` copies them into the
JSON and `buildLegend` prints the same strings, so the console and the HTML can
never disagree. A new variant or query type without one renders a blank cell in
the artifact's description table.

## `count` vs `list-detail` — query vs request

`count` is one `getAggregates` call: the `COUNT(*) + AVG(age) + AVG(income)`
behind a single tile.

`list-detail` is one whole `GET /v1/contacts/list-detail`. It mirrors
`ContactsService.fetchListDetailAggregates`: resolve the load-bearing base tile
first, then fan out to the three channel tiles (`hasCellPhone` / `hasLandline` /
`hasAddress`) in parallel. **Four aggregates, not one** — benchmarking `count`
alone understates a real request by roughly the tile count, and the
serial-then-parallel shape is what decides how long a connection is held.

It runs in latency mode at **every** band, in both the shapes the sheet actually
opens in: unfiltered (the universe row) and filtered (a saved list — every 504
in the week to 2026-08-16 was segment-scoped, so the unfiltered cell alone would
miss the failing shape).

In load mode, concurrency for `load:list-detail:*` counts **saved lists, not
queries**: `ListsIndex` fires one request per saved list on mount, so `c=10` is
a ten-list page load and already four times that many aggregates in flight. On
2026-08-13 one org with ~20 lists produced a burst of timeouts within minutes,
several inside a single second, while the same query was fine single-shot. If
`load:list-detail:mega` passes at `c=50` and prod still 504s, the gap is
somewhere other than this query.

## Read the cold number first

Cells print as `cold|median/max`. The median/max are warm runs; `cold` is the
first hit. Cold is not noise to be discarded here — it is the production failure
shape. The loader cuts prod to a **brand-new cluster** with an empty buffer
pool, so in production every district is cold at once. A cell reading
`ERR|<median>/<max>!1` means the cold run blew the statement timeout while the
warm runs passed; that is the real incident, not a flake.

## Prior-outreach id clauses

Three variants cover the three ways gp-api turns a "prior contacts made"
selection into SQL (`ContactsMadeResolutionService`, see
`src/contacts/AGENTS.md` §ENG-10839):

| variant            | wire shape                | SQL                        |
| ------------------ | ------------------------- | -------------------------- |
| `outreach-include` | `filters.id.in`           | `v."id" = ANY($1::uuid[])` |
| `outreach-exclude` | `filters.id.notIn`        | `v."id" != ALL($1::uuid[])`|
| `outreach-mixed`   | `contactsMadeIdOverrides` | top-level AND of an OR     |

They need real ids, so `harness.sampleIds` materializes one set per cohort.
`runLatency`/`runLoad` call **`harness.prepare(cases)` before the timed loop** —
sampling is setup, and folding it into the first outreach cell of each band
inflated that one cell badly enough to make it unreadable.

Sets are memoized per district and seeded (`ID_SAMPLE_SEED`) so the same ids
come back on every run: a delta between two passes has to be a real regression,
not a different sample. Ordering by a hash also scatters them across the
partition the way a real outreach list does, rather than handing the planner a
run of neighbours in index order.

Two things about the sampling queries are load-bearing, both measured against
prod:

- **The district path does NOT join `Voter`.** `dv."voter_id"` already is the
  id, and joining costs one random probe into a cold multi-GB state partition
  per sampled row — measurably slower per cohort, by enough to dominate setup.
- **A State district has zero `DistrictVoter` rows** (verified: count is 0), so
  statewide *must* sample from `Voter` — the voter-only branch is required, not
  an optimization. It uses `stateEquals` rather than a hand-written cast: the
  enum lives in `public`, not `green`, and the state has to be inlined as a
  literal because a bound-and-cast parameter breaks the planner's constant
  propagation. An md5-prefix bucket keeps that sort off the whole partition.

All three share one `ID_SET_SIZE` (5k) set, so the only thing differing between
them is the SQL shape. The hard production cap is `MAX_RESOLVED_ID_SET_SIZE`
(100k); if you add a size axis, expect it to dominate the pass. At statewide
these run at `HEAVY_ITERATIONS` for that reason.

## Deliberately out of scope (future additions)

- `groupByHousehold`: expressible but needs its own axis.
- CI wiring: prod people-db is VPC-private; the intended path is a scheduled
  in-VPC ECS task (see the design doc). The JSON artifact is shaped for it.
