// Dev and every PR preview run their voter reads (contacts list, stats,
// counts, precincts, door-knocking packs and turf routes) on one shared
// Databricks SQL warehouse, so a statement queues behind every other
// concurrent E2E run. On 2026-11-04 (release run 41858979252) those requests
// took 20-56s each for about 10 minutes while two PR E2E runs overlapped the
// release (ENG-11574). A wait on a warehouse-backed response or render must
// outlast that queue, not the idle-warehouse p99 of ~3s.
export const WAREHOUSE_WAIT_MS = 90_000
