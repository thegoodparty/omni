# Data Model

The Prisma schema is split across one file per model under `prisma/schema/` (enabled by the `prismaSchemaFolder` preview feature in `prisma/schema/schema.prisma`). All entities use UUID primary keys, snake_case columns mapped via `@map`, and the standard `createdAt`/`updatedAt` audit fields.

## Entities

### `Place` — `prisma/schema/place.prisma`
A geographic entity (state, county, city, township, etc.) identified by a Census `geoId`. Self-referential parent/child relation forms a hierarchy via `PlaceHierarchy`. Sources demographics ("fun facts": population, density, income, home value, unemployment).
- **Unique:** `slug` (e.g., `tx/hidalgo/mission`), `geoId`
- **Relations:** `Race[]`, recursive `Place[]` parent/children
- **Notes:** `mtfcc` is the Census MAF/TIGER feature class code; `state` is `Char(2)`. The ETL appends a `-<geoId>` suffix to a slug that loses a collision (`tx/hidalgo/mission-4848072`), so never recompose a place slug in app code — read it.

### `Race` — `prisma/schema/race.prisma`
A specific election contest at a `Place` for a particular position on a particular `electionDate`. Carries Ballotready (`brHashId`, `brDatabaseId`) and per-race metadata (filing window, eligibility, salary, partisan/runoff/primary flags).
- **Indexed:** `slug`, `positionId`, `placeId`, `brHashId`
- **Relations:** `Place?`, `Position?`, `Candidacy[]`
- **Enum:** `PositionLevel { CITY, COUNTY, FEDERAL, LOCAL, REGIONAL, STATE, TOWNSHIP }`
- **Note:** `slug` is the place slug plus the slugified normalized position name (`tx/hidalgo/mission/county-sheriff`). It is the only place that pairing exists — `Position` carries no slug and no `Place` — so it doubles as the canonical office slug for a sitting officeholder. `positionLevel` is non-null here, unlike the nullable `Position.level`.

### `Candidacy` — `prisma/schema/candidacy.prisma`
A person running in a `Race`. Denormalizes parts of the candidate's Person + Position records from Ballotready (first/last name, party, image, about, urls, salary, election frequency, normalized position name).
- **Unique:** `slug` (slugified `firstName-lastName-normalizedPositionName`)
- **Relations:** `Race?`, `Stance[]`
- **Enum:** `ElectionResult { WON, LOST, RUNOFF }`

### `Position` — `prisma/schema/position.prisma`
The "office being run for" — a Ballotready position scoped to a `District`. The bridge between geography and `Race`.
- **Unique:** `brPositionId` (the Ballotready source position id — must be unique)
- **Relations:** `District?`, `Race[]`, `OfficeHolder[]`, `ZipToPosition[]`
- **Note:** `brDatabaseId` is a `String` here (outlier — the rest of the schema uses `Int`). Don't propagate this style; see `ZipToPosition` for the rationale.
- **Note:** there is deliberately **no** `Place` relation — `placeId` was dropped in `20260722000000_drop_position_place_id` because the position mart never populated it. Reach a position's geography through its `Race[]` instead.

### `OfficeHolder` — `prisma/schema/officeHolder.prisma`
A term a `Person` holds (or held) in an office — the "elected official" spine behind the public `/people` profiles.
- **Indexed:** `personId`, `positionId`
- **Relations:** `Person` (required, cascades), `Position?`
- **Note:** `positionId` is nullable and the officeholder mart fills it with a lossy left join (no `not_null` test upstream), so any traversal through it must degrade gracefully rather than assume a position.

### `District` — `prisma/schema/district.prisma`
An L2 voter-file district (e.g., a state house district, a school board district). Identified uniquely by `(state, L2DistrictType, L2DistrictName)`.
- **Relations:** `ProjectedTurnout[]`, `Position[]`, `DistrictTopIssue[]`, `DistrictVoterDensity[]`, `DistrictVoterDensityMeta[]`

### `DistrictTopIssue` — `prisma/schema/districtTopIssue.prisma`
Top political issues per district, sourced from Haystaq voter scoring. `score` is the average Haystaq score (0-100), `issueRank` is the rank within the district (1 = highest).
- **Unique:** `(districtId, issue)`

### `DistrictVoterDensity` / `DistrictVoterDensityMeta` — `prisma/schema/districtVoterDensity.prisma`
Precomputed voter-density heat-map cells for a district, one row per H3 cell per resolution, plus a per-`(district, resolution)` coverage row. Serves `GET /v1/persons/:personId/voter-density`; gp-api relays it to the public `/people` profiles.
- **PK:** `(districtId, resolution, h3Index)` on the cells, `(districtId, resolution)` on the meta; the cells also carry an explicit `(districtId, resolution)` index, the only shape the app queries.
- **Relations:** `District` (real FK on both — a cell keyed on a uuid no district has fails the load rather than rendering an empty map)
- **Privacy contract:** every row is an aggregated, k-anonymized cell (`voterCount >= minCellCount`) whose `(lat, lng)` is the deterministic H3 cell centroid, never a voter location. No PII columns, and no H3 math in Postgres — the centroid is precomputed upstream, so the read is a plain indexed lookup.
- **Note:** `coverage` (`renderedVoters / totalVoters`) is the only meta column the app reads, and it reads it to decide whether to render the map at all. The rest is build provenance, kept so a sparse district can be explained without re-running the pipeline; `minCellCount` records the K a build actually used, which is the only way to tell after the fact whether a district was cut at the agreed policy K.
- **Loader rule — rebuild each district whole.** A `merge` on the cell key upserts surviving cells but cannot delete a cell that dropped below K since the last run, and that stale row leaks exactly the suppression K exists to enforce. Full-rebuild the mart, or do a whole-district `delete + insert`. Never a plain merge on `(district_id, resolution, h3_index)`.
- **Loader rule — load after `District`, and guard the FK.** Stage the insert behind a `WHERE EXISTS (SELECT 1 FROM "District" d WHERE d.id = district_id::uuid)`, the same way `CANDIDACY_UPSERT_QUERY` guards `race_id` in `write__election_api_db.py`. Skipping a row for a district that hasn't landed yet is correct — the next push re-offers it. Failing the whole load on one is not.

### `ProjectedTurnout` — `prisma/schema/projectedTurnout.prisma`
Modeled turnout for a district in a given election year. Stamped with `inferenceAt` and `modelVersion` so callers can reason about freshness.
- **Indexed:** `(districtId, electionYear)`
- **Enum:** `ElectionCode { General, LocalOrMunicipal, ConsolidatedGeneral }`
- **Note:** physically mapped to `Projected_Turnout` (snake_case + Pascal — preserved from the upstream ETL)

### `Issue` — `prisma/schema/issue.prisma`
A Ballotready-sourced political issue. Self-referential `IssueHierarchy` for parent/child topic structure.
- **Relations:** `Issue?` parent, `Issue[]` children, `Stance[]`

### `Stance` — `prisma/schema/stance.prisma`
A candidate's stance on an issue. Stored verbatim from Ballotready (`stanceStatement`, `stanceReferenceUrl`, `stanceLocale`).
- **Relations:** `Issue` (required), `Candidacy?`

### `ZipToPosition` — `prisma/schema/zipToPosition.prisma`
Denormalized ZIP → position rollup, sourced from a dbt mart in `gp-data-platform`. Lets API callers find positions by ZIP without joining `Position` + geographic tables.
- **Unique:** `(zipCode, positionId, electionDate)`
- **Indexed:** `zipCode`, `positionId`, `(zipCode, pctDistrictzipToZip)`
- **Note:** Field names + `accepted_values` constraints are dictated by the upstream dbt model. The `brDatabaseId Int` choice intentionally diverges from `Position.brDatabaseId String` to match the mart and the rest of the schema.

## Common query patterns

- **Find a place by hierarchy slug** — `slug` is unique on `Place`; query `where: { slug }` then optionally include `parent` / `children`. See `src/places/places.service.ts`.
- **Position lookup from a ZIP** — query `ZipToPosition` by `zipCode`; the row carries denormalized `displayOfficeLevel`, `officeType`, `district`, etc. so the response can be built without a join.
- **Candidate cards for a race** — `Race.findUnique({ where: { slug }, include: { Candidacies: { include: { Stances: { include: { Issue: true } } } } } })`.
- **Office slug for a sitting officeholder** — `OfficeHolder.positionId` → `Position` → most recent `Race`, then read `Race.slug`/`Race.positionLevel`. See `src/persons/persons.service.ts`. A candidate reaches the same slug via `Candidacy.Race`.
- **Top issues by district** — `DistrictTopIssue.findMany({ where: { districtId }, orderBy: { issueRank: 'asc' } })`.
- **Heat map for a district** — `DistrictVoterDensity.findMany({ where: { districtId, resolution } })` plus the matching `DistrictVoterDensityMeta` row for `coverage`. See `src/persons/persons.service.ts`.

## Conventions

- All PKs are `String @id @db.Uuid`. Generate UUIDs in app code, not at the DB.
- `@map("snake_case")` on every column; Prisma model names stay PascalCase.
- Add `@@map("...")` only when the table physical name diverges from the Prisma model name (e.g., `Projected_Turnout`).
- Indexes for any field commonly used in `where` — see existing schemas for examples (`positionId`, `placeId`, `zipCode`).
- `String[]` arrays are used liberally (party, urls, electionFrequency, positionNames). Don't normalize these into join tables without a real querying need; they're write-once from the upstream ETL.
- **Never edit applied migrations under `prisma/schema/migrations/<timestamp>/`** — they're immutable. Create a new migration with `npm run migrate:dev`.

## Source of truth

Most rows are populated by ETL in `gp-data-platform`, not by this API. `election-api` is read-mostly from the application's perspective. New columns / models are typically added in the ETL first, then surfaced here via a new migration.
