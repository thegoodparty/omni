# src/residentVoices/

`GET /v1/resident-voices`: the comments the Serve welcome's map flies
between, for the office in `X-Organization-Slug` (`@UseOrganization()`, an
`eo-` org or 400, no feature flag). Response, contracts'
`ResidentVoicesResponseSchema`:
`{ voices: { id, quote, lat, lon, synthetic }[], syntheticCount }`, six at
most (`RESIDENT_VOICES_MAX`).

- **It never fails the welcome.** No district, a missing table, no grant, a
  bad table name, or a read slower than `RESIDENT_VOICES_TIMEOUT_MS` (4000)
  is a 200 with `{ voices: [], syntheticCount: 0 }` and a `warn` line
  (`resident voices read failed` or `resident voices read timed out`). The
  webapp skips the map on an empty list. A read that works logs
  `resident voices read` with its counts.
- **The rule is `pickResidentVoices`**, the design's `pickVoices`: real
  comments first (not synthetic, source not `311`, `location_status`
  `verified_in_district`, has a point), by tier then `display_rank`; then the
  district's synthetic rows by `display_rank` until there are six.
- **Nothing else crosses.** The statement selects no name, user or campaign
  id, topic or date, and the response carries no source or tier. The point is
  already fuzzed in the table. Every card looks the same; `synthetic` exists
  only so the map can say under itself that comments are synthesized.
- **The district** is the org's, resolved by
  `OrganizationsService.getDistrictAndLevelForOrgSlug`. Its `id` is the
  table's `district_id`: both are the election database's district id.
- **The read** is `ResidentVoiceQueryService` in `src/peopleDb/`, on the
  people Databricks identity, from the table named in
  `RESIDENT_VOICES_TABLE` (`src/peopleDb/AGENTS.md`, "Resident comments").
  That identity has no access to the default sandbox table, so every
  environment answers empty until the data team publishes the table into
  `mart_gp_api` and the variable names it.
  `docs/adr/2026-11-25-resident-comments-read-live-from-databricks.md`.
- **Never copy rows from the table** into the repo, a fixture or a log. The
  tests (`tests/residentVoices.routes.test.ts`) stub
  `PeopleDbxStatementClient.query` with invented text.
