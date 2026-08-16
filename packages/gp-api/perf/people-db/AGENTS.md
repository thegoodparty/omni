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

Results print as a table and are written to `scripts/output/people-db-bench-<env>-<sha>-<mode>.json`.

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

## Deliberately out of scope (future additions)

- `activity-condition` filtering: resolved gp-api-side into `idOverrides` /
  `contactsMadeIdOverrides` from contact-interaction rows; not a `PeopleFilters`
  field, so the pure harness cannot synthesize it.
- `id-set` (`filters.id`) and `groupByHousehold`: expressible but need a per-run
  setup step (sample real ids first); add as a separate axis when needed.
- CI wiring: prod people-db is VPC-private; the intended path is a scheduled
  in-VPC ECS task (see the design doc). The JSON artifact is shaped for it.
