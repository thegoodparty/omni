# Voter-Density Heat Map — Data-Team Handoff

> **Audience:** the `gp-data-platform` (dbt on Databricks + Airflow) team.
> **Status:** app side (gp-api + gp-marketing) is built against the contract in
> this doc and is live-behind-empty-data. This document is the spec for the
> **data** half. Nothing here has been implemented in `gp-data-platform` — it is
> the deliverable for that team.

## 1. Goal

Render a smooth voter-density heat map on public `/people/<slug>-<personId>`
profiles. The map shows *where the constituents of a person's office/district
live*, as a density surface — never individual voters.

The app never computes density at request time. The data team precomputes an
**aggregated, k-anonymized, H3-binned** density table per district and loads it
into the **people-db** Postgres — the `green`-schema database gp-api reads
in-process via its `src/peopleDb/` module (the same cluster that backs
`DistrictVoter` / `Voter`). gp-api reads the two density tables read-only and
proxies the cells to the public page.

## 2. Privacy contract (non-negotiable)

Every row we publish MUST satisfy all of:

1. **Aggregated only.** A row is an H3 cell with a voter *count*, never a voter,
   address, or household.
2. **K-anonymity.** Suppress any cell whose `count < K`. `K` is a policy input
   (see Phase 0); default proposal **`K = 10`**. Suppressed voters still count
   toward coverage denominators but never produce a row or move a rendered
   centroid.
3. **Centroid-only geometry.** The published `(lat, lng)` is the **deterministic
   H3 cell centroid** (`h3_centeraswkt(h3)`), never a voter's lat/lng, never a
   cell mean of voter positions. Two different voter distributions inside the
   same cell produce the identical published point.
4. **No overlays.** Density counts only. No partisan / demographic / turnout
   breakdown per cell (reidentification risk). Out of scope, permanently, unless
   legal signs off separately.
5. **No PII columns.** The table has no name, address, LALVOTERID, or voter id.

## 3. dbt models to build

Mirror the conventions of the existing `int__l2_district_aggregations.sql`
(same H3 UDFs, same salted-uuid district keying, same incremental strategy).

### 3.1 `int__people_db__voter_h3.sql` (intermediate, ephemeral or table)

Parse each voter's residence lat/lng and bin to H3.

```sql
-- Pseudocode / Databricks SQL sketch
with parsed as (
  select
    v.lalvoterid,
    v.state,
    try_cast(v.residence_addresses_latitude  as double) as lat,
    try_cast(v.residence_addresses_longitude as double) as lng,
    v.residence_addresses_latlongaccuracy   as latlong_accuracy
  from {{ ref('stg_l2__voters') }} v      -- adapt to the real staging ref
)
select
  lalvoterid,
  state,
  lat,
  lng,
  latlong_accuracy,
  -- One column per published resolution. Add/remove to match §6 policy.
  h3_longlatash3(lng, lat, 7) as h3_r7,
  h3_longlatash3(lng, lat, 8) as h3_r8,
  h3_longlatash3(lng, lat, 9) as h3_r9
from parsed
where lat is not null
  and lng is not null
  -- US bounding-box sanity filter drops obviously-bad geocodes (0/0, swapped
  -- signs, non-US). Tighten per state if needed.
  and lat between 17.0 and 72.0
  and lng between -180.0 and -64.0
```

Notes:
- `try_cast` (not `cast`) so a non-numeric lat/lng yields NULL and is dropped,
  never fails the model.
- `h3_longlatash3` takes **(lng, lat, res)** — longitude first. Keep the order
  identical to `int__l2_district_aggregations.sql`.
- Keep `latlong_accuracy` around for the coverage/meta model and Phase-0
  analysis (rooftop vs zip-centroid).

### 3.2 `m_people_db__district_voter_density.sql` (mart → loaded to Postgres)

Join voters to their districts (the existing `m_people_db__districtvoter`
bridge — the same one that feeds `DistrictVoter`), group by `district_id + h3`,
k-suppress, and emit the cell centroid.

```sql
{{ config(materialized='incremental', unique_key=['district_id','resolution','h3_index']) }}

with district_voter as (
  select dv.district_id, dv.voter_id, dv.state
  from {{ ref('m_people_db__districtvoter') }} dv
  join {{ ref('district') }} d on d.id = dv.district_id
  -- Statewide voter files are enormous and meaningless as a "where they live"
  -- surface; the app never requests a State district. Exclude here.
  where d.type <> 'State'
),
exploded as (
  -- Unpivot the per-resolution h3 columns from int__people_db__voter_h3 into
  -- (voter, resolution, h3_index) rows so one grouping handles all resolutions.
  select dv.district_id, dv.state, x.resolution, x.h3_index
  from district_voter dv
  join {{ ref('int__people_db__voter_h3') }} vh on vh.lalvoterid = dv.voter_id  -- adapt join key
  lateral view explode(map(
     7, vh.h3_r7,
     8, vh.h3_r8,
     9, vh.h3_r9
  )) x as resolution, h3_index
  where x.h3_index is not null
),
agg as (
  select
    district_id,
    resolution,
    h3_index,
    any_value(state) as state,
    count(*) as voter_count
  from exploded
  group by district_id, resolution, h3_index
)
select
  district_id,
  resolution,
  h3_index,
  h3_centerlat(h3_index) as lat,   -- or parse from h3_centeraswkt(h3_index)
  h3_centerlng(h3_index) as lng,
  voter_count,
  state,
  current_timestamp() as updated_at
from agg
where voter_count >= {{ var('voter_density_k', 10) }}   -- K-anonymity suppression

{% if is_incremental() %}
  -- Re-aggregate only the districts whose voters changed since last run. A
  -- district must be fully recomputed (not merged cell-by-cell) or suppressed
  -- cells would leak as a diff. Delete+insert affected district_ids.
  and district_id in (
    select distinct district_id from {{ ref('m_people_db__districtvoter') }}
    where updated_at > (select max(updated_at) from {{ this }})
  )
{% endif %}
```

- **Centroid:** use `h3_centeraswkt(h3_index)` and parse, or the
  `h3_centerlat/h3_centerlng` helpers if available in the Databricks H3 lib.
  Whatever `int__l2_district_aggregations.sql` uses — match it.
- **Incremental:** re-aggregate *whole* affected districts (delete+insert per
  `district_id`), never merge single cells, so K-suppression stays correct.
- **Resolutions:** emit the set agreed in §6. The app filters by `resolution`.

### 3.3 `m_people_db__district_voter_density_meta.sql` (mart → loaded to Postgres)

Coverage bookkeeping per `(district_id, resolution)`, used by the app to decide
whether the map is trustworthy enough to render and to draw the legend.

```sql
with base as (
  select dv.district_id, x.resolution,
         count(*) as total_voters,
         count(vh.h3_index) as geocoded_voters   -- voters with a usable H3
  from {{ ref('m_people_db__districtvoter') }} dv
  left join exploded_or_voter_h3 ...   -- same explode as §3.2
  group by dv.district_id, x.resolution
),
rendered as (
  select district_id, resolution,
         sum(voter_count) as rendered_voters,
         count(*)         as rendered_cells
  from {{ ref('m_people_db__district_voter_density') }}   -- post-suppression
  group by district_id, resolution
),
suppressed as (
  select district_id, resolution, count(*) as suppressed_cells
  from <pre-suppression agg>
  where voter_count < {{ var('voter_density_k', 10) }}
  group by district_id, resolution
)
select
  b.district_id,
  b.resolution,
  b.total_voters,
  b.geocoded_voters,
  coalesce(r.rendered_voters, 0)  as rendered_voters,
  coalesce(s.suppressed_cells, 0) as suppressed_cells,
  {{ var('voter_density_k', 10) }} as min_cell_count,
  -- coverage = fraction of the district's voters represented by rendered
  -- (non-suppressed) cells. The app hides the map below a threshold.
  case when b.total_voters > 0
       then coalesce(r.rendered_voters, 0)::double / b.total_voters
       else 0 end as coverage,
  any_value(b.state) as state,
  current_timestamp() as updated_at
from base b
left join rendered r using (district_id, resolution)
left join suppressed s using (district_id, resolution)
```

## 4. Key derivation — `district_id`

`district_id` MUST equal the shared `District.id` used everywhere else
(`election-api.District.id == people-db.District.id`). **Reuse, never mint.**

Use the same salted-uuid helper as the district models:

```sql
generate_salted_uuid([state, l2_district_type, l2_district_name])
```

This is the identical call that produces `District.id` in the district mart, so
the density table joins cleanly to `DistrictVoter` / `District` and to
election-api's `Position.district_id`. If you compute the id any other way the
app's `districtId` lookups silently return empty.

## 5. Load path (Airflow)

Load the two marts into the **people-db** Postgres **after** districts, so the
FK target rows exist.

- Add `load_district_voter_density()` (and `load_district_voter_density_meta()`)
  to the people-db loader dag, sequenced **after `load_districts()`** (FK
  ordering: `DistrictVoterDensity.district_id` → `District.id`).
- If the density row count is large enough that the bespoke loader is slow,
  instead register the two marts in the people-db loader's `_MART_MODELS` list
  and let the generic loader handle them (same as other marts).
- Cadence: `@daily`, matching the other people-db marts.
- Load is a **full replace per district** on the incremental set (see §3.2), or
  a truncate+reload for a first cut — coordinate with whichever the loader does
  for `DistrictStats`.

The table DDL to create these two tables in people-db is the additive migration
`packages/gp-api/prisma-people/schema/migrations/20260803000000_add_voter_density_heatmap/migration.sql`
(CREATE TABLE + CREATE INDEX only; it reuses the existing `public."USState"`
enum and touches no existing table).

## 6. Phase-0 questions (answer before we finalize resolution/K)

These gate the resolution + K policy and the legal go/no-go. Please answer with
data:

1. **lat/lng fill-rate per state.** What fraction of L2 voters have a non-null,
   US-in-bounds `Residence_Addresses_Latitude/Longitude`? Break down by state —
   coverage will vary and drives which states can render a map at all.
2. **`Residence_Addresses_LatLongAccuracy` distribution.** What share is
   rooftop / interpolated / **zip-centroid**? Zip-centroid geocodes pile many
   voters onto one point and will produce artificially hot cells — we may need
   to down-weight or exclude them, or coarsen resolution where they dominate.
3. **Recommended resolution policy per office level.** Proposal to validate:
   - Federal / statewide-ish large districts → **res 6–7**
   - County / large city → **res 7–8**
   - City ward / small local → **res 8–9**
   Confirm the H3 resolutions to emit and the office-level → resolution mapping.
   (The app selects a resolution per request; default today is **res 8**.)
4. **K threshold.** Confirm `K` (default proposal **10**). Legal/policy may
   require higher. This is a dbt `var('voter_density_k')` so it is one number to
   change.
5. **Legal / governance sign-off.** Explicit approval to publish aggregated,
   k-anonymized voter *residence density* on public, unauthenticated pages.
   Confirm the aggregation + K + centroid-only contract in §2 satisfies the
   agreement with L2 and internal policy.

## 7. Postgres table contract (source of truth — matches prisma-people)

These tables live in people-db's **`green`** schema. Column names/types below
are exactly what the app reads; the loader must write this shape. (`State` uses
the existing `public."USState"` enum, same as `DistrictVoter`.) The canonical
definition is gp-api's `prisma-people/schema/DistrictVoterDensity.prisma` plus
the migration in §5.

### `green."DistrictVoterDensity"`

| column        | type                    | notes                                        |
|---------------|-------------------------|----------------------------------------------|
| `district_id` | `uuid`                  | == `District.id` (salted-uuid; §4)           |
| `resolution`  | `integer`               | H3 resolution of this row                    |
| `h3_index`    | `text`                  | `h3_h3tostring(h3)` — opaque to the app      |
| `lat`         | `double precision`      | H3 **cell centroid** latitude (§2.3)         |
| `lng`         | `double precision`      | H3 **cell centroid** longitude               |
| `voter_count` | `integer`               | count in cell; **always `>= K`** (§2.2)      |
| `State`       | `public."USState"` enum | two-letter state                             |
| `updated_at`  | `timestamp`             | mart run time                                |
| **PK**        | `(district_id, resolution, h3_index)` |                                |
| **index**     | `(district_id, resolution)`           | the app's only query pattern   |

### `green."DistrictVoterDensityMeta"`

| column             | type                    | notes                                         |
|--------------------|-------------------------|-----------------------------------------------|
| `district_id`      | `uuid`                  | == `District.id`                              |
| `resolution`       | `integer`               |                                               |
| `coverage`         | `double precision`      | rendered_voters / total_voters ∈ [0,1] (§3.3) |
| `min_cell_count`   | `integer`               | the `K` used for this build                   |
| `total_voters`     | `integer`               | district voters at this resolution grain      |
| `geocoded_voters`  | `integer`               | voters with a usable H3                        |
| `rendered_voters`  | `integer`               | sum of `voter_count` over non-suppressed cells|
| `suppressed_cells` | `integer`               | cells dropped by K-anonymity                  |
| `State`            | `public."USState"` enum |                                               |
| `updated_at`       | `timestamp`             |                                               |
| **PK**             | `(district_id, resolution)` |                                          |

## 8. What the app already does (for your validation)

- gp-api reads `green."DistrictVoterDensity"` (+ `DistrictVoterDensityMeta`)
  directly from people-db via `src/peopleDb/services/voterDensity.service.ts`
  (`getVoterDensity(districtId, resolution)`), returning
  `{ coverage, cells: [{ lat, lng, count }] }` for the district/resolution. No
  H3 math in Postgres — it just returns the precomputed centroids. `resolution`
  defaults to **8** when omitted.
- gp-api resolves `personId → Position.districtId` (via election-api) and reads
  the above, returning `{ coverage, cells }` to the public page
  (`GET /v1/public-person-profiles/voter-density`). A person that maps to no
  district 404s; a district with no rows returns empty cells.
- gp-marketing renders `cells` as a deck.gl `HeatmapLayer` (weight = `count`)
  over a MapLibre basemap, and **hides the map** when `coverage` is low or
  `cells` is empty — so a district with no/low coverage simply shows no map, no
  error.
