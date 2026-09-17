// Databricks statement-status polling, as issued by PeopleDbxStatementClient's
// awaitCompletion loop.
//
// Undici instrumentation excludes these from tracing. `startCsvExport` submits
// with `wait_timeout: 0s` and then polls every 500ms up to the 60s ceiling, so
// a single export produces ~120 identical GETs. Traces are unsampled, so that
// is real ingest carrying no information the `databricks.statement` span does
// not already carry end to end.
//
// Deliberately narrow. The submit POST and the chunk fetches must keep their
// spans — those are the requests that move the payload, and they are the ones
// worth seeing when a voter read is slow. The `$` (with an optional query
// string) is what keeps `/cancel` and the chunk routes out of the match.
const DBX_STATEMENT_POLL_PATH =
  /^\/api\/2\.0\/sql\/statements\/[^/?]+(?:\?.*)?$/

export const isDbxStatementPoll = (method: string, path: string): boolean =>
  method === 'GET' && DBX_STATEMENT_POLL_PATH.test(path)
