import { Alert } from './alerts.types'

/**
 * Both series come from gp-api's own OTLP export, so they select on the
 * resource labels every other `metric` rule here uses.
 */
const SELECTOR = 'service_name="gp-api", deployment_environment_name="$ENV"'

const MISMATCH = `vendor_schema_mismatch_total{${SELECTOR}}`

/**
 * Vendor responses that failed their shared Zod schema in live mode, by vendor
 * and endpoint (drift layer 2; counter added in M4-2, see
 * `src/vendors/shared/vendorSchema.metrics.ts`).
 *
 * The OTel counter is `vendor_schema_mismatch`; Prometheus appends `_total`.
 *
 * **Two clauses, because `increase()` alone misses the first mismatch.** A
 * counter series does not exist until its first `add`, so the first event ever
 * recorded for a vendor and endpoint appears as a series that starts at 1 and
 * stays at 1. Prometheus has no earlier sample to subtract, so `increase()`
 * reads 0 for exactly the event this rule exists to catch. The second clause
 * covers it: a (vendor, endpoint) pair that has a value now and had none an
 * hour ago is new, and new means a mismatch happened inside the window.
 *
 * Both aggregate with `sum by (vendor, endpoint)` first, which is what makes
 * them addable across tasks (each task exports its own series; see
 * docs/observability.md § Counters need per-task identity) and what makes the
 * `unless` compare like with like.
 */
const MISMATCH_EXPR = [
  `sum by (vendor, endpoint) (increase(${MISMATCH}[1h]))`,
  `or (sum by (vendor, endpoint) (${MISMATCH}) unless sum by (vendor, endpoint) (${MISMATCH} offset 1h))`,
].join('\n')

/**
 * Vendor drift alerts.
 *
 * Both route to `dev-alerts`, which is the default receiver in the routing
 * policy: no per-alert route is needed and `EXPECTED_PROD_RECEIVERS` is
 * unchanged. The TDD names the 10DLC channel (`bot-10dlc-compliance`) for
 * vendor drift; that needs a new Grafana contact point and is an open question,
 * deliberately not decided here.
 *
 * **Absence is healthy, for both.** Grafana's `noDataState: OK` (grafana.ts)
 * applies, which is what keeps these quiet: the counter only exists once a
 * mismatch has happened, and the gauge only once the daily count has run.
 */
export const vendorDriftAlerts: Alert[] = [
  {
    slug: 'vendor-schema-mismatch',
    name: '[Win] Vendor response failed its schema',
    type: 'metric',
    expr: MISMATCH_EXPR,
    // Any mismatch at all. One series per (vendor, endpoint), so each pair
    // that drifted raises its own instance.
    threshold: 0,
    for: '0m',
    // Held a window past the last increase so a vendor that keeps drifting is
    // one page, not a page that resolves and re-fires as the 1h window rolls.
    keepFiringFor: '1h',
    evaluationIntervalSeconds: 300,
    timeRangeSeconds: 3600,
    summaryDetail: '`{{ $labels.vendor }}` `{{ $labels.endpoint }}`',
    message: [
      'A live vendor response failed its shared schema in the last 60 minutes. `vendor` and `endpoint` on this alert say which call; `endpoint` is a path template, not a concrete URL.',
      'The vendor changed a response shape, or the schema was wrong. The schema is `src/vendors/<vendor>/schemas/` in gp-api. Find the offending fields in Loki, where `parseVendorResponse` logs the failing field paths as `issuePaths`: `{service_name="gp-api", deployment_environment_name="$ENV"} |= "Vendor response did not match schema"`, narrowed to the vendor named above. Fix the schema (and the mock that mirrors it) rather than loosening validation.',
      'The counter only exists after a first mismatch, so a quiet rule means no mismatch, not a broken one.',
    ].join('\n\n'),
  },
  {
    slug: 'vendor-mock-record-rows-in-prod',
    name: '[Win] Vendor mock rows exist in prod',
    type: 'metric',
    // Max across tasks: one stale task must not hide a real row, and a count
    // is not additive across the tasks that report it.
    expr: `max(vendor_mock_record_rows{${SELECTOR}})`,
    threshold: 0,
    for: '0m',
    // The gauge is written once a day by a single task. Evaluating it every
    // five minutes costs nothing, and a longer interval would only delay a page
    // for a condition that is already a day stale.
    evaluationIntervalSeconds: 300,
    message: [
      '`vendor_mock_record` has rows in prod. Mock rows are written only by the non-prod vendor mocks, so this means mock mode reached production: a vendor call was answered by a mock, or a test fixture was run against the prod database.',
      'The count is recorded once a day by gp-api (VendorMockRecordAuditService), so this page can be up to a day behind. Inspect the rows: `SELECT vendor, kind, external_id, created_at FROM vendor_mock_record ORDER BY created_at`. Find what wrote them, and which flag or URL pointed a vendor client at a mock. The alert resolves after the rows are gone and the next daily count reads 0, or when no task has reported for a while.',
    ].join('\n\n'),
  },
]
