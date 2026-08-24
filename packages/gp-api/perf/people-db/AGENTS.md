# people-db benchmark suite

In-process latency + load benchmarks for the gp-api `peopleDb` services
(`src/peopleDb/`). Boots a minimal Nest context against a chosen people-db and
drives the real service methods. Design: `docs/superpowers/specs/2026-07-31-people-db-benchmark-suite-design.md`.

## Run it

MUST run with the swc-node loader (the `perf:people-db` npm script does this).
`tsx` does NOT work: esbuild drops decorator metadata and Nest DI resolves to
`undefined`.

```bash
# On the VPN. Export the target people-db read-only URL first (SSM/Secrets
# Manager per the workspace CLAUDE.md). prod requires the VPN.
export PEOPLE_DATABASE_URL='<connection-string>'

npm run perf:people-db -- --mode=latency --env=dev    # the matrix, p50/p95
npm run perf:people-db -- --mode=load --env=dev        # concurrency sweep + gate
npm run perf:people-db -- --smoke --env=dev            # one case, boot check
```

Results print as a table and are written to
`scripts/output/people-db-bench-<env>-<sha>-<mode>.json`, plus a
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
(observation-only): that band already cold-runs past the 25s statement timeout
single-shot, and at c=50 all 50 requests are cold at once, so a 0 budget there
would make `FAIL` the permanent baseline instead of a regression signal. They
still record numbers in the artifact — they just can't red the gate. Tighten
them once a load pass gives a measured error rate to calibrate against. At
least one scenario must keep a 0 budget or the gate is decorative.

## Cohort bands are NOT ordered by cost

Bands are `small` (~8k) / `medium` (~65k) / `large` (~400k) / `mega` (~900k) /
`statewide` (~23M), each pinned to one real district in `cohorts.ts`. The names
describe **district membership**, which turns out to be a poor predictor of
query time. Two things dominate it instead:

**1. Whether the query joins at all.** `resolveDistrict.util.ts` sets
`useVoterOnlyPath` when a district's type is `State` and its name matches the
state. That nulls the `districtId`, so the query becomes a single
partition-pruned scan of `Voter` with **no `DistrictVoter` join**. `statewide`
is therefore the cheapest per row, not the most expensive — treat it as the
no-join control.

**2. Which state partition it probes.** The join is a nested loop: one index
probe into `Voter_<STATE>` per district member. Cost is dominated by how
resident that partition is, not how many members the district has.

Measured 2026-08-16 (prod, unfiltered base aggregate, warm):

| band  | district          | members | partition             | time                         |
| ----- | ----------------- | ------- | --------------------- | ---------------------------- |
| large | US Cong 29, CA    | 398,619 | CA — 429M rows / 63GB | **18.7s** (25s timeout cold) |
| mega  | Orange County, FL | 898,598 | FL — 116M rows / 17GB | **1.7s**                     |

`mega` has 2.3x the membership and runs 11x faster. It was added 2026-08-16 as
the suite's **first non-CA cohort** for exactly this reason: every other band is
a California district, so before it the suite could not tell a district-size
regression from a state-partition one. It is also the org behind 175 of the 274
`GET /v1/contacts/list-detail` 504s in the week to 2026-08-16 — which, given it
benchmarks at 1.7s single-shot, points at contention or cold cache rather than a
slow plan. That is what `load:count:mega` is for.

**`large` is currently the slowest cell in the suite** and its cold run exceeds
the 25s statement timeout, so `count:large:*` may legitimately report failures.
Re-measure before assuming a regression is new.

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
alone understates a real request by ~4x, and the serial-then-parallel shape is
what decides how long a connection is held.

It runs in latency mode at **every** band, in both the shapes the sheet actually
opens in: unfiltered (the universe row) and filtered (a saved list — every 504
in the week to 2026-08-16 was segment-scoped, so the unfiltered cell alone would
miss the failing shape).

In load mode, concurrency for `load:list-detail:*` counts **saved lists, not
queries**: `ListsIndex` fires one request per saved list on mount, so `c=10` is
a ten-list page load and already ~40 aggregates in flight. On 2026-08-13 one org
with ~20 lists produced 201 timeouts in 19 minutes — 22 inside a single second —
while the same query single-shot measures ~1.7s. If `load:list-detail:mega`
passes at `c=50` and prod still 504s, the gap is somewhere other than this
query.

## Read the cold number first

Cells print as `cold|median/max`. The median/max are warm runs; `cold` is the
first hit. Cold is not noise to be discarded here — it is the production failure
shape. The loader cuts prod to a **brand-new cluster** with an empty buffer
pool, so in production every district is cold at once. A cell reading
`ERR|18678/19201!1` means the cold run blew the 25s statement timeout and the
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
inflated that one cell by ~50s. Whole-suite prepare measures ~14s.

Sets are memoized per district and seeded (`ID_SAMPLE_SEED`) so the same ids
come back on every run: a delta between two passes has to be a real regression,
not a different sample. Ordering by a hash also scatters them across the
partition the way a real outreach list does, rather than handing the planner a
run of neighbours in index order.

Two things about the sampling queries are load-bearing, both measured against
prod:

- **The district path does NOT join `Voter`.** `dv."voter_id"` already is the
  id, and joining costs one random probe into a cold multi-GB state partition
  per sampled row: 44-60s per cohort with the join, ~0.5-1.2s without it.
- **A State district has zero `DistrictVoter` rows** (verified: count is 0), so
  statewide *must* sample from `Voter` — the voter-only branch is required, not
  an optimization. It uses `stateEquals` rather than a hand-written cast: the
  enum lives in `public`, not `green`, and the state has to be inlined as a
  literal because a bound-and-cast parameter breaks the planner's constant
  propagation. An md5-prefix bucket keeps that sort off all 23M rows.

All three share one `ID_SET_SIZE` (5k) set, so the only thing differing between
them is the SQL shape. The hard production cap is `MAX_RESOLVED_ID_SET_SIZE`
(100k); if you add a size axis, expect it to dominate the pass. At statewide
these run at `HEAVY_ITERATIONS` for that reason.

## Deliberately out of scope (future additions)

- `groupByHousehold`: expressible but needs its own axis.
- CI wiring: prod people-db is VPC-private; the intended path is a scheduled
  in-VPC ECS task (see the design doc). The JSON artifact is shaped for it.
