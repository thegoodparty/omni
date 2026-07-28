# Slow aggregate/count plan behind the 10,000 fence (ENG-10807)

Investigation, not a fix. `people-api` fences count/aggregate queries that hit the
2.5s `SLOW_QUERY_TIMEOUT_MS` statement timeout (`queryWithTimeoutFence`,
`FENCE_LIMIT = 10000`, both in `src/people/services/people.service.ts`). The
ticket's report: broad counts/aggregates fence even on ~28-44k-voter districts,
which "should" be fast. This doc captures what was found, ranks root-cause
hypotheses by confidence, and lists proposed follow-ups. See `docs/data-pipeline.md`
for the general read pipeline and `CLAUDE.md` for the fence mechanism summary.

## TL;DR

The fence isn't really about district size. `rawCountForDistrict` and
`getAggregates` both join `DistrictVoter -> Voter` and, for any query that isn't
the fully-unfiltered count, that join has exactly one reasonable plan available
today: a hash join with a full sequential scan of the **entire state's Voter
partition** as the probe side. Confirmed locally (reproduced, not just argued) —
see [Captured plans](#captured-plans). The query's cost tracks the **state's**
total voter population, not the district's, so a "small" 30-40k-voter district
in a large state (CA/TX/NY/FL, ~10-25M voters each) is exactly as expensive as a
huge one — and that scan, run cold right after a monthly ETL cluster cutover,
plausibly exceeds 2.5s on its own, before any filter predicate is even
considered. Separately, `getAggregates` has **no unfiltered fast path at all**
(unlike `rawCountForDistrict`'s `DistrictStats` shortcut), so it pays this cost
on every call, including the trivial no-filter case.

Confidence: **high** that the join/plan shape is the direct mechanism (reproduced
locally, plan choice validated against the forced alternative). **Medium** on the
"cold cache after ETL rebuild" amplifier (plausible, matches the ETL cadence, not
independently confirmed against prod telemetry — see [Dead ends](#dead-ends--limitations)).
**Low** that a missing/vanished loader index is the direct cause of _this_
symptom (real index drift exists — see [Index inventory](#index-inventory) — but
it doesn't explain the observed plan).

## Background: the fence mechanism

From `people.service.ts` (current code, ENG-10804/ENG-10706 era):

- `SLOW_QUERY_TIMEOUT_MS = 2500`. Every `rawCountForDistrict` and `getAggregates`
  call runs its primary SQL under `SET LOCAL statement_timeout`. On Postgres
  57014 (statement cancelled), it retries once with a "fenced" variant — the
  same WHERE wrapped in an **unordered** subquery capped `LIMIT 10000`
  (`FENCE_LIMIT`) — and reports `fenced: true` out to gp-api/gp-webapp.
- The voter **list** fence (`queryPeopleWithTimeoutGuard`) is scoped to
  name-search only, because fencing an ordered/paginated list would silently
  drop rows from the page. The **count** and **aggregates** fences apply to
  _every_ call, including plain filters like `gender is not_null`, per the
  comment already in the code (lines 39-57).
- `rawCountForDistrict` has a **fast path**: if there's a `districtId`, no
  `groupByHousehold`, no `search`, and zero filters, it skips SQL entirely and
  reads `DistrictStats.totalConstituents` (a precomputed rollup). Any filter,
  search term, or grouped mode falls through to the real join query below.
- `getAggregates` (`buildAggregatesSql`) has **no such fast path** — it always
  builds and runs the join query, even when `dto.filters.filters.length === 0`.

## The query shapes

Both go through `buildVoterWhereSql` (`src/people/utils/buildVoterWhereSql.utils.ts`),
which:

- inlines `State` as a SQL literal (not a bind parameter) on both sides of the
  join — a **prior, already-shipped fix** for a related planner trap: a
  parameterized `State` breaks equivalence-class constant propagation across
  `v."State" = dv."State"`, forcing a seq scan + hash join regardless of filter
  shape (comment at lines 19-24 of that file). This fix is in place and doesn't,
  by itself, solve the pattern described here — see below.
- ANDs in `dv."district_id" = $1`, `dv."voter_id" IS NOT NULL`, and whatever
  `buildVoterFiltersSql` (`filters.sql.utils.ts`) emits for the requested filters.

`rawCountForDistrict`'s primary SQL (`people.service.ts` lines 288-297):

```sql
SELECT COUNT(*)::bigint AS voter_count
FROM "green"."DistrictVoter" dv
JOIN "green"."Voter" v ON v."State" = dv."State" AND v."id" = dv."voter_id"
WHERE v."State" = 'CA'::"public"."USState"
  AND dv."State" = 'CA'::"public"."USState"
  AND dv."district_id" = $1::uuid
  AND dv."voter_id" IS NOT NULL
  -- + whatever buildVoterFiltersSql emits, e.g.:
  AND v."Gender" IS NOT NULL
```

`getAggregates` -> `buildAggregatesSql` (`utils/buildAggregatesSql.utils.ts`) is the
same join/WHERE with a different SELECT:

```sql
SELECT
  COUNT(*)::bigint AS count,
  AVG(v."Age_Int")::float8 AS "avgAge",
  AVG(v."Estimated_Income_Amount_Int")::float8 AS "avgIncome"
FROM "green"."DistrictVoter" dv
JOIN "green"."Voter" v ON v."State" = dv."State" AND v."id" = dv."voter_id"
WHERE ...
```

The fenced variants of both wrap this in `FROM (SELECT v.* ... LIMIT 10000) v`.

`buildRawPeopleQuery` (the voter **list**) shares the same join and WHERE but adds
`ORDER BY v."id" LIMIT <pageSize> OFFSET <skip>` — the `LIMIT` matters; see
[Captured plans](#captured-plans), Q5.

## Reproduction method and its limits

people-api's `Voter`/`DistrictVoter` are LIST-partitioned by `State` on both dev
and prod (confirmed against the `gp-data-platform` loader — see
[Index inventory](#index-inventory)), but Prisma migrations don't run against
those loader-built clusters, and the local dev DB created via
`npm run migrate:dev` / `prisma db push` is a **flat, unpartitioned** table.
There is no local/VPN-free way to reproduce native partition pruning, real
per-state row counts, or a genuinely cold Aurora storage cache. What _can_ be
reproduced faithfully: the join/aggregation plan choice for a single state's
worth of data, and the index inventory that plan choice depends on — partition
pruning only decides _which_ physical partition the planner touches, not _how_
it joins DistrictVoter to Voter once inside it, so this is a legitimate,
if partial, test of the mechanism.

Setup: an isolated throwaway Postgres 16.8 container (not the shared local dev
DB), schema via `prisma db push` (so only the indexes actually declared on the
`Voter`/`DistrictVoter` Prisma models exist — deliberately excluding the
migration-only indexes discussed below, to mirror what's live on the real
loader clusters), then a synthetic dataset:

- 800,000 `Voter` rows, all `State = 'CA'` (stand-in for one big state
  partition; real CA is roughly 20-30x this row count, order of magnitude).
- A target `District` with exactly 35,000 linked voters via `DistrictVoter`
  (mid the ticket's 28-44k band), plus 5 "large" districts (~50-60k each) and
  some smaller ones sharing the same voter pool, so `district_id` cardinality
  isn't degenerate.
- `ANALYZE` after load (the loader always runs `VACUUM (ANALYZE)` after
  `build_indexes` — see below — so this matches that step).

Full seed SQL and EXPLAIN queries: see the commands below; not committed as
fixtures because they're throwaway and dataset-shape-specific, not a repeatable
test asset.

## Captured plans

All captured with `EXPLAIN (ANALYZE, BUFFERS, TIMING)` against the reproduction
above — real execution, not estimates. Trimmed to the decision-relevant nodes.

**Q1 — `rawCountForDistrict` shape, `Gender IS NOT NULL`, target district (35k):**

```
Finalize Aggregate  (actual time=111.771..114.226 rows=1 loops=1)
  Buffers: shared hit=8092 read=16144
  -> Gather (Workers Launched: 2)
     -> Partial Aggregate
        -> Parallel Hash Join  (actual time=5.760..108.201 rows=11433 loops=3)
           Hash Cond: (v.id = dv.voter_id)
           -> Parallel Seq Scan on "Voter" v  (actual rows=261333 loops=3)
                Filter: (("Gender" IS NOT NULL) AND ("State" = 'CA'::public."USState"))
           -> Parallel Hash
              -> Parallel Bitmap Heap Scan on "DistrictVoter" dv (actual rows=11667 loops=3)
                 -> Bitmap Index Scan on "DistrictVoter_pkey"
                      Index Cond: (district_id = '...' AND voter_id IS NOT NULL)
Execution Time: 114.275 ms
```

The DistrictVoter side is cheap and correctly index-driven (Bitmap Index Scan on
the PK, 640 buffer hits). All the cost is the **Parallel Seq Scan on the entire
Voter table for the state** — every row in the `Voter` partition gets read and
filtered, not just the ~35k that belong to the district.

**Q2 — `getAggregates` shape** (same WHERE, `COUNT` + `AVG(Age_Int)` +
`AVG(Estimated_Income_Amount_Int)`): identical plan shape, 159ms.

**Q3 — same shape on a ~50-60k "large" district:** identical plan shape, 124ms.
Notably _not_ proportionally slower than the 35k district — because the
dominant cost (the Voter seq scan) doesn't depend on district size at all.

**Q4 — political-party filter** (`Parties_Description ILIKE '%democrat%'`, target
district): same plan shape, but 258ms — the seq scan's per-row filter cost is
much higher because `ILIKE` with a leading wildcard can't use any index
(no trigram index exists on `Parties_Description` — see
[Index inventory](#index-inventory)), so every one of the 800k rows gets a
full case-insensitive substring match evaluated in the scan.

**Q5 — the voter LIST shape** (`buildRawPeopleQuery`, `ORDER BY v."id" LIMIT 25`):

```
Limit (actual time=0.030..0.241 rows=25 loops=1)
  -> Nested Loop (actual time=0.028..0.238 rows=25 loops=1)
     -> Index Scan using "DistrictVoter_pkey" on "DistrictVoter" dv
     -> Index Scan using "Voter_pkey" on "Voter" v (loops=25)
Execution Time: 0.268 ms
```

Completely different plan, and cheap: the `LIMIT 25` lets the planner justify a
nested loop that stops after 25 probes instead of materializing the whole
match set. **This is why the list path doesn't show the same symptom** — only
queries that must aggregate over _every_ matching row (no `LIMIT`) are exposed.

**Q6 — fenced-subquery shape** (`LIMIT 10000` inner, matching the actual fence
fallback): 17.6ms — much cheaper, because the `LIMIT` inside the Gather lets
workers stop early, same mechanism as Q5. Confirms the fence's own remediation
works as designed once triggered; the question is why the _primary_ query needs
it at 35k rows in the first place.

**Q7 — same join, no filter at all** (isolates the join's inherent cost): 115ms,
indistinguishable from Q1. The gender filter added negligible cost on its own —
almost the entire query time is the unconditional table scan.

**Confirming the plan choice is cost-optimal, not a misfire** — forced nested
loop (`SET enable_hashjoin = off; SET enable_mergejoin = off;`) on the Q1 query:

```
Nested Loop (actual time=3.351..440.696 rows=17150 loops=2)
  Buffers: shared hit=139815 read=826 written=136
  -> Parallel Bitmap Heap Scan on DistrictVoter (rows=17500 loops=2)
  -> Index Scan using "Voter_pkey" on "Voter" v (loops=35000)
Execution Time: 451.814 ms
```

~4x slower than the planner's chosen hash join (452ms vs 114ms), and touches
~140k buffer pages (vs ~24k) doing 35,000 independent random single-row probes
into `Voter`'s primary key. **The planner is making the locally-correct call.**
There is no available index that turns this into a cheap nested loop for the
_unbounded_ aggregate case — the fenced/list paths only escape it because they
add a `LIMIT` that lets the planner stop early, which a `COUNT`/`AVG` over the
full match set structurally cannot do.

## Index inventory

Cross-checked three sources: the Prisma model (`prisma/schema/*.prisma`, what a
fresh `prisma db push`/local dev DB gets), the Prisma **migrations**
(`prisma/schema/migrations/`, which per prior investigation do **not** run
against the loader-built dev/prod clusters — `_prisma_migrations` is frozen
there), and the `gp-data-platform` loader's actual index registry
(`people-api-loader/src/loader/people_api/schema/`:
`_serving_seed.py` is captured from `pg_catalog` on the extraction-source
cluster; `_serving_seed_extra.py` is the hand-maintained list that survives an
`_serving_seed.py` regeneration).

| Index                                                                                                                | Prisma model    | Prisma migration    | Loader (`_serving_seed`/`_extra`)                                                                                                            | Relevant here?                                                                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------------- | --------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Voter` single-column indexes (Gender, Education_Of_Person, Business_Owner, Parties_Description, Age_Int, ~250 more) | yes (`@@index`) | —                   | **yes**, all present in `_serving_seed.py`                                                                                                   | No — confirmed present on loader clusters; not the bottleneck (Q1/Q7 show the seq scan happens regardless, since the query needs to read/count matching rows anyway)                                                                                                       |
| `DistrictVoter` PK `(district_id, voter_id)`                                                                         | yes (`@@id`)    | —                   | yes — rebuilt as `(district_id, voter_id, "State")` on the partitioned cluster (partition key must be part of any PK on a partitioned table) | No — leading column is still `district_id`; confirmed cheap in every captured plan                                                                                                                                                                                         |
| `Voter_firstname/lastname_lower_idx`, `*_trgm_idx`, `Voter_last_first_id_idx`                                        | no              | yes (`20251208...`) | **yes**, via `_serving_seed_extra.py` (PR #632, merged 2026-07-20)                                                                           | No — name-search only, unrelated to count/aggregate; confirms the earlier trigram-index risk (memory: manual 2026-07-16 build) is now durable across ETL rebuilds                                                                                                          |
| `DistrictVoter_voter_id_idx`, `DistrictVoter_district_id_idx`                                                        | no              | yes (`20251208...`) | **no**                                                                                                                                       | No — dead on loader clusters, but `district_id` is already the PK's leading column so this doesn't change any plan; `voter_id`-alone isn't used by any query shape examined here                                                                                           |
| `Voter_parties_desc_lower_idx` (functional `lower(Parties_Description)`)                                             | no              | yes (`20251208...`) | **no**                                                                                                                                       | No — this indexed an exact-match party lookup that the code no longer does (`buildPoliticalPartyFilter` now does substring `ILIKE`, not equality — see comment in `filters.sql.utils.ts` "Replaces the previous exact-equality mapping"). Stale migration, not a live gap. |
| `Voter_cell_fmt_nn_idx` / `Voter_landline_fmt_nn_idx` (partial, non-null phone)                                      | no              | yes (`20251208...`) | **no**                                                                                                                                       | Possibly relevant to `hasCellPhone`/`hasLandline` filters _without_ a district join, but not to this symptom                                                                                                                                                               |
| pg_trgm on `Parties_Description`                                                                                     | no              | no                  | **no**                                                                                                                                       | Contributing to Q4's extra cost (ILIKE can't use any index), but the plain-filter case (Q1/Q7) is just as slow without it — not the primary driver                                                                                                                         |

**Takeaway:** there is real, previously-undocumented drift between what
`prisma/schema/migrations/` declares and what's live on the loader-built
clusters (4 dead index declarations found), consistent with the known
"Prisma migrations don't run against loader clusters" constraint. None of the
missing ones explain the reported symptom — the `DistrictVoter` side of the
join is already served by its PK either way, and the `Voter` side needs a
full scan regardless of which single-column indexes exist, because the query
must visit every row that matches the join, not a bounded subset.

## Root cause, ranked

1. **(High confidence) Query shape: `DistrictVoter -> Voter` full-partition scan
   for any non-trivial count/aggregate.** Any `rawCountForDistrict`/`getAggregates`
   call that isn't the fully-unfiltered fast path requires visiting every row
   in the requesting state's `Voter` partition, because materializing the exact
   match set (no `LIMIT`) makes a full sequential scan + hash join cheaper, by
   Postgres's own cost model, than tens of thousands of random index probes —
   confirmed by forcing the alternative plan and measuring it 4x slower. Cost
   scales with **state** population, not **district** population, which is why
   "should be fast" 28-44k-voter districts aren't: the number that actually
   predicts the timeout is the state's total voter count, and the ticket's own
   framing (fencing "even at" that size) is consistent with this — it isn't a
   coincidence that only _some_ districts of that size trip it.

2. **(High confidence, structural) `getAggregates` has no unfiltered fast path.**
   Unlike `rawCountForDistrict` (which shortcuts to `DistrictStats` when there's
   no search/filter/grouping), `buildAggregatesSql` runs the full join
   unconditionally. Every list-detail page load that calls `getAggregates` — the
   ENG-10706 "membership" endpoint — pays this cost even with zero filters
   applied, on every request, for every district in a large state. This is
   likely the single highest-volume trigger of the fence in practice, since it
   fires on page load rather than only when a user applies a broad filter.

3. **(Medium confidence, amplifier, not independently confirmed) Cold cache
   right after the monthly ETL rebuild.** The loader stands up a fresh cluster
   every rebuild and cuts over (`people-api-voter-partitioning-and-loader-seed`
   prior finding); a freshly cut-over cluster's buffer pool and any OS-level
   page cache start cold for a partition nobody has queried yet. A full
   sequential scan of a multi-GB-to-multi-tens-of-GB state partition against
   cold network-attached storage is categorically slower than the same scan
   warm — plausible, consistent with the ETL cadence, but not verified against
   real prod timing/telemetry in this investigation (Grafana MCP wasn't
   reachable from this environment — see below).

4. **(Low confidence) Missing/vanished loader-owned index.** Real drift exists
   (see table above) but doesn't map to this symptom on the evidence gathered:
   the `DistrictVoter` side is already efficiently served by its PK regardless,
   and no per-column `Voter` index changes the fact that a full,
   unbounded-`LIMIT` join against that table requires reading every candidate
   row. The name-search trigram-index risk flagged in a prior investigation is
   confirmed **resolved** (PR gp-data-platform#632 merged 2026-07-20, before
   this investigation) and is a different query path (list-only, LIKE-pattern
   only) from the one this ticket is about.

## Why dev/QA never surfaces this

People-api's dev DB only has voter rows for NC, DC, and WY (documented in
`CLAUDE.md` "Dev data coverage (QA gotcha)"). All three are small-population
states. Under hypothesis #1, the fence is driven by the **state's** total
Voter row count, so dev/QA structurally cannot reproduce this — there's no
large-state partition to scan slowly. This also means the existing local dev
DB (even if it had partitioning) couldn't have caught this class of bug; it
needs either a large-state-shaped dataset (as built for this investigation) or
production data.

## Proposed follow-ups

Each described here for the orchestrator to file as ClickUp tickets; not
implemented as part of this investigation per the ticket's scope.

1. **(Us, gp-api/people-api) Give `getAggregates` an unfiltered fast path.**
   Mirror `rawCountForDistrict`'s `DistrictStats` shortcut for the
   `filters.filters.length === 0` case: `count` comes from
   `DistrictStats.totalConstituents` directly. `avgAge`/`avgIncome` don't have
   an exact precomputed equivalent today (`DistrictStats.buckets` stores
   histogram buckets per demographic, not a mean), so this needs a product/data
   decision — either derive an approximate mean from the existing age/income
   buckets (bucket-midpoint weighted average, already-shipped data, no new ETL
   work, but an approximation) or have the data platform add real
   precomputed `avgAge`/`avgIncome` columns to `DistrictStats`. This alone
   would remove the single highest-volume trigger (every list-detail page
   load with no filters applied).

2. **(Us + Data Platform, design-level) Reduce the count/aggregate join's
   dependence on state-wide table size.** The durable fix is denormalizing the
   commonly-filtered demographic columns actually used in filters (Gender,
   Education_Of_Person, Age_Int, Estimated_Income_Amount_Int, party
   classification, phone presence) onto `DistrictVoter` itself, or a
   district-scoped materialized/rollup table, so a district-scoped filtered
   count/aggregate is bounded by district size instead of state size. This is
   a real schema/ETL change, not a query tweak — needs its own design pass
   with the data platform team (who owns the loader and the ETL cadence).

3. **(Data Platform) Warm the buffer/page cache for large-state partitions
   after each ETL cutover.** If hypothesis #3 (cold cache) is a real
   contributor, a `pg_prewarm` pass over the largest state partitions
   (CA/TX/NY/FL/...) as a post-`build_indexes` step, similar to the existing
   `VACUUM (ANALYZE)` step, would remove the "first hour after rebuild" tax
   without any query-shape change. Cheap to try; needs prod telemetry to
   confirm it's worth doing (see follow-up 5).

4. **(Data Platform, cleanup) Reconcile the 4 dead Prisma-migration index
   declarations** (`DistrictVoter_voter_id_idx`, `DistrictVoter_district_id_idx`,
   `Voter_parties_desc_lower_idx`, `Voter_cell_fmt_nn_idx`/`Voter_landline_fmt_nn_idx`)
   against the loader's `_serving_seed_extra.py`. Not a fix for this ticket,
   but they're misleading as committed migration files that imply indexes exist
   in prod that don't — either land the still-useful ones (the partial
   non-null phone indexes may help `hasCellPhone`/`hasLandline` filters outside
   a district join) in `_serving_seed_extra.py`, or delete the dead migration
   files and note in `docs/data-pipeline.md` that Prisma migrations under
   `prisma/schema/migrations/` are local-dev-only and don't reflect the
   loader-built clusters' real index set.

5. **(Us, observability) Log state + district size on every fence trip.**
   `queryWithTimeoutFence`'s existing warn log (`elapsedMs`) doesn't currently
   capture which state/district triggered it. Adding those fields would let a
   follow-up correlate real fence trips against state population size and
   time-since-last-ETL-rebuild, turning hypotheses #1 and #3 from "locally
   reproduced" into "confirmed against production traffic."

## Dead ends / limitations

- **No prod/Grafana access used for this investigation**, per the ticket's
  explicit no-VPN/no-prod-credentials instruction. The Grafana MCP referenced
  in the top-level `CLAUDE.md` was not reachable from this environment (not
  present in the available tool set this session), so hypothesis #3 (cold
  cache) and the real per-state row-count distribution are not independently
  confirmed against production logs/telemetry — see follow-up 5.
- **Local reproduction cannot show native partition pruning or genuinely cold
  Aurora storage latency** — the local DB is a flat, unpartitioned table (see
  [Reproduction method](#reproduction-method-and-its-limits)). The captured
  plans validate the _join/aggregation_ mechanism (which partitioning doesn't
  change), not the _cross-partition_ or _cold-storage_ dynamics layered on top
  in prod.
- **Real per-state Voter row counts weren't available** (no prod DB access);
  the "CA/TX/NY/FL are 20-30x this test's 800k rows" comparison is an
  order-of-magnitude estimate from public voter-registration figures, not a
  measured prod number.
