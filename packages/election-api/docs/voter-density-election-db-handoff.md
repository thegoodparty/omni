# Voter Density — Moving the Serving Tables to election-db

Companion to `packages/gp-api/docs/voter-density-heatmap-handoff.md`, which
specifies the pipeline itself. **Nothing about the privacy contract, the H3
binning, the K-suppression, or the centroid derivation changes.** This document
covers only the move of the two serving tables from people-db to election-db,
and what the data platform needs to publish differently as a result.

## 1. Why

Today a single heat map costs gp-api two lookups in two databases: an HTTP call
to election-api to turn a person into a district, then a read against people-db
for that district's cells. The district lives in election-db and the cells live
in people-db, so the join that matters is split across a service boundary.

With both in election-db, `GET /v1/persons/:personId/voter-density` answers the
whole question in one query, and people-db leaves the path entirely.

## 2. Target tables (already created — do not create them yourself)

election-api owns the DDL through Prisma migrations, the same as `Candidacy`,
`District`, and `Person`. The tables exist as of migration
`20260831000000_add_district_voter_density`. The loader's job is to publish rows
into them, never to create or alter them.

### `public."District_Voter_Density"`

| Column        | Type             | Notes                                    |
| ------------- | ---------------- | ---------------------------------------- |
| `district_id` | `UUID NOT NULL`  | FK to `District(id)`. See §3.             |
| `resolution`  | `INTEGER NOT NULL` | H3 resolution of this row.              |
| `h3_index`    | `TEXT NOT NULL`  | `h3_h3tostring(h3)`; opaque to the app.   |
| `lat`         | `DOUBLE PRECISION NOT NULL` | H3 cell centroid latitude.     |
| `lng`         | `DOUBLE PRECISION NOT NULL` | H3 cell centroid longitude.    |
| `voter_count` | `INTEGER NOT NULL` | Count in cell; always `>= min_cell_count`. |
| `state`       | `TEXT NOT NULL`  | Two-letter state. See §4.                 |
| `updated_at`  | `TIMESTAMP(3) NOT NULL` | Mart run time.                     |

Primary key `(district_id, resolution, h3_index)`, plus an index on
`(district_id, resolution)` — the only shape the app ever queries.

### `public."District_Voter_Density_Meta"`

| Column             | Type                        | Notes                              |
| ------------------ | --------------------------- | ---------------------------------- |
| `district_id`      | `UUID NOT NULL`             | FK to `District(id)`.               |
| `resolution`       | `INTEGER NOT NULL`          |                                    |
| `coverage`         | `DOUBLE PRECISION NOT NULL` | `rendered_voters / total_voters`.   |
| `min_cell_count`   | `INTEGER NOT NULL`          | The K a build actually used.        |
| `total_voters`     | `INTEGER NOT NULL`          |                                    |
| `geocoded_voters`  | `INTEGER NOT NULL`          |                                    |
| `rendered_voters`  | `INTEGER NOT NULL`          |                                    |
| `suppressed_cells` | `INTEGER NOT NULL`          |                                    |
| `state`            | `TEXT NOT NULL`             |                                    |
| `updated_at`       | `TIMESTAMP(3) NOT NULL`     |                                    |

Primary key `(district_id, resolution)`.

Both tables are column-for-column the people-db originals, with the two
differences noted in §4.

## 3. `district_id` — the ids already match, and now the database enforces it

The original handoff's §4 asked you to derive `district_id` with
`generate_salted_uuid([state, l2_district_type, l2_district_name])` so that it
would equal `District.id` in both databases. That requirement is unchanged, and
it is already satisfied by something stronger than a matching derivation:

`m_people_api__district` is a **view selecting straight out of**
`m_election_api__district`. The two District tables are not two derivations of
the same key, they are the same rows copied. So every `district_id` that loads
into people-db today already exists in election-db by construction.

The one asymmetry runs the safe direction: the people-api view drops the single
`state = 'US'` country-scope row, so people-db's District set is a strict subset
of election-db's. There is no district the cells can reference that election-db
lacks.

Because of that, these tables carry a real foreign key to `District(id)` —
something people-db could not have, since District lived in a different database
there. That was the failure mode worth closing: a cell keyed on a stale or
differently-salted uuid used to insert cleanly, and the only symptom was a map
that silently never rendered for that district. Now the load fails instead.

**What this means for the loader:** if a density row can ever be staged for a
district the swap has not landed yet, guard the insert the way
`CANDIDACY_UPSERT_QUERY` guards `race_id` in
`dbt/project/models/write/write__election_api_db.py`:

```sql
WHERE EXISTS (
    SELECT 1 FROM {db_schema}."District" AS d WHERE d.id = district_id::uuid
)
```

Skipping the row is correct — the next full push re-offers it once the district
exists. Failing the whole load on one unlanded district is not.

Load density **after** `District`, same ordering the people-db DAG already uses.

### Confirming it, if you want the number rather than the argument

The claim above is structural, so it holds by construction rather than by
sampling. If you want it confirmed against live data anyway, this is the check,
and it should return zero — run it in the warehouse, where both marts are
visible at once (the two Postgres databases are not mutually reachable, so
there is no cross-database version of this query):

```sql
select count(*) as orphaned_cells
from {{ ref("m_people_api__district_voter_density") }} as d
left join {{ ref("m_election_api__district") }} as e on d.district_id = e.id
where e.id is null
```

A non-zero result means the density mart is minting ids rather than reusing the
bridge's, and the migration should stop until that is fixed — the FK in §3 would
reject exactly those rows at load time.

## 4. Two schema differences from people-db

1. **No `green` schema.** election-db is single-schema; these live in `public`.
2. **`state` is `TEXT`, not the `USState` enum.** It matches the `District.state`
   it now sits beside, which is also a plain string. Publish the same
   two-letter values you publish today; nothing upstream changes. This also
   means the `'US'` row that people-api had to exclude for enum reasons is not a
   problem here.

## 5. Materialization — the full-rebuild rule still holds

Unchanged from the original handoff §3.2, and worth restating because it is the
one thing a straightforward port would get wrong: each district must be
recomputed **as a whole**. A cell-key `merge` upserts surviving cells but cannot
delete a cell that dropped below K since the last run, and that stale row leaks
exactly the suppression the K threshold was there to enforce.

Full-rebuild the mart, or do a whole-district `delete + insert`. Never a plain
merge on `(district_id, resolution, h3_index)`.

## 6. Dual-read window — both destinations, for now

gp-api reads both sources side by side and compares them before the cutover, so
for the duration of that window the pipeline must keep publishing to **both**
people-db and election-db from the same build. If only one side is refreshed,
the comparison metric reports divergence that is purely a staleness artifact.

The comparison is exposed as
`person_profile_voter_density_compare_count_total{result}`, with
`only_legacy` / `only_new` distinguishing "the two disagree" from "one side has
not been loaded". Once that reads clean, gp-api flips to election-api, and the
people-db marts and their entries in
`people-api-loader/src/loader/people_api/config.py` can be decommissioned.

## 7. Checklist

- [ ] New marts `m_election_api__district_voter_density` and
      `..._meta`, same logic as the `m_people_api__*` pair, full-rebuild
      materialization.
- [ ] Upsert queries in `write__election_api_db.py`, mirroring
      `DISTRICT_UPSERT_QUERY`, with the guarded `District` existence check
      from §3.
- [ ] Load ordered after `District`.
- [ ] Both people-db and election-db published from the same build for the
      duration of the dual-read window (§6).
- [ ] After cutover: drop the `m_people_api__*` density marts and their loader
      config entries.
