import { ControllerName, ROUTE_MAP } from '../../../src/generated/route-types'
import { Alert, RecordingRule } from './alerts.types'
import {
  ALERT_OWNERSHIP,
  ROUTE_ERROR_THRESHOLDS,
  SERVER_ERRORS_ONLY,
} from '../alerts'

// 400 is excluded because a 400 is never evidence of a fault on its own. In
// this codebase it is overwhelmingly designed vocabulary — Zod rejecting a
// payload, an eligibility refusal (VOTER_DATA_UNAVAILABLE), a Serve org asking
// for a Win-only filter, the 100k id-set cap — and nothing in a generated rule
// can tell one of those from an accidental one. Counting it paged on the
// product working: the Pro gate alone did it with a single free-tier user
// before it moved to 403 (#1847), and every route that validates its input can
// be made to fire by anyone typing a bad value. A real fault answers 5xx, or
// answers nothing at all (see noStatusFilter below), and those still page.
//
// The cost is real and accepted: a 400 that IS a bug — a webapp sending a
// payload the API stopped accepting, say — no longer pages, and shows up as a
// support report or in the logs instead.
// Exported so a handler that must NOT answer one of these can assert against
// the real list rather than a copy of it — see payments.controller.test.ts.
export const EXCLUDED_STATUS_CODES = [400, 401, 403, 404, 409, 498]

// The notification has to state the same vocabulary the filter applies, so it
// reads from the constant instead of restating it. The previous hardcoded
// prose was already one edit away from lying to whoever it paged.
const EXCLUDED_STATUS_PROSE = EXCLUDED_STATUS_CODES.join('/')

// A request the gateway kills mid-flight completes with `statusCode: null`,
// which is neither 4xx nor 5xx — so every status-range filter below misses it
// and the worst failure a route has (no answer at all) paged nobody. Two
// door-knocking pack timeouts in the seven days to 2026-08-25 were invisible
// for exactly this reason. Loki's json parser drops a null field, and a label
// filter reads a missing label as empty, so this is the shape that matches it
// whether the field is absent or empty. It admits no status code at all, and
// therefore none of the 4xx noise SERVER_ERRORS_ONLY exists to suppress.
//
// THE DURATION FLOOR IS WHAT MAKES IT USABLE, and it was missing. A null status
// says only "we never answered", which covers two unrelated things: the gateway
// gave up on us, and the caller gave up on us. The second is not a fault and
// there is nothing to do about it — the line is logged at `info`, with
// `bytes: null` and a duration in the low hundreds of milliseconds:
//
//   {"msg":"Request completed","request":{"endpoint":"GET /v1/users/me"},
//    "response":{"statusCode":null,"bytes":null},"responseTimeMs":207}
//
// It is also the overwhelming majority. Over the 30 days to 2026-09-17, null
// statuses split 165 over 30s / 307 under in prod, and 3 over / 2,345 under in
// dev, where the E2E suite aborts requests as it navigates. So four fifths of
// what this clause matched was users closing tabs, and enabling it across every
// controller would have paged on that until someone muted the result.
//
// 30s is well clear of any real handler (the p99 of a normal route is orders
// of magnitude below it) and well under the gateway's ~120s idle timeout, so
// it keeps every genuine "no answer" case — including both door-knocking pack
// timeouts above — and discards the aborts. A route that legitimately streams
// for longer than this needs its own treatment rather than a wider floor here.
//
// ON `mcp` THIS FLOOR IS LOAD-BEARING TO THE MILLISECOND, which is worth
// knowing before anyone moves it. Its no-status completions are not the
// gateway: over the 30 days to 2026-09-17, the 24 on POST /v1/mcp land at
// 30001-30007ms (19 of them), at exactly 30000ms (4), and one at 28753ms,
// while POST /v1/ecanvasser/:id/sync in the same window sits at
// 118733-120007ms. A cluster that tight on 30s is the calling MCP client's own
// request deadline expiring, not infrastructure severing the connection.
//
// That is still a fault and still worth paging on — the caller waited a full
// 30 seconds for a tool call and gp-api never answered, and the fix is the
// route behind the tool — but it means 19 of those 23 deadline expiries clear
// this floor by between 1 and 7 milliseconds. Raising NO_STATUS_MIN_MS at all
// silences mcp's entire measured error signal.
//
// The strict `>` drops the 4 logged at exactly 30000ms. Those 4 lines are the
// only no-status completions at that value anywhere in prod over the window, so
// `>=` would cost 4 events in 30 days and buy back 17% of this controller's
// signal — but it also rewrites the expression of every generated rule in the
// estate, which is the kind of retune the field's own docs say to do
// deliberately rather than in passing. Left alone on purpose, and written down
// so the next person does not have to measure it again.
const NO_STATUS_MIN_MS = 30_000
const NO_STATUS_PROSE = '30 seconds'
const noStatusFilter = `response_statusCode = "" and responseTimeMs > ${NO_STATUS_MIN_MS}`

// Parenthesized rather than left to operator precedence: `A and B or C` is one
// misread away from `A and (B or C)`, which would count every 401.
const orNoStatus = (statusFilter: string) =>
  `( ${statusFilter} ) or ( ${noStatusFilter} )`

const anyErrorFilter = orNoStatus(
  [
    'response_statusCode >= 400',
    ...EXCLUDED_STATUS_CODES.map((code) => `response_statusCode != ${code}`),
  ].join(' and '),
)
const serverErrorFilter = orNoStatus('response_statusCode >= 500')

// ---------------------------------------------------------------------------
// The two queries that read Loki
// ---------------------------------------------------------------------------

// WHAT REPLACED WHAT. Until 2026-09-28 each of these rules ran its own Loki
// query: 74 controllers, each selecting the entire
// `{service_name="gp-api", deployment_environment_name="prod"}` stream and then
// narrowing to its own routes with `| json | request_endpoint =~ ...`. Loki
// bills decompressed bytes and only the stream selector and the fetch window
// change that number, so every one of those rules paid for all of gp-api's
// logs in order to look at its slice, once a minute. Measured over the 24h to
// 2026-09-28: 2,690 GB/day from the route rules alone. Grafana Cloud started
// returning 429 and, because `exec_err_state` is `Alerting` (deliberately, and
// it stays), all 154 rules fired at once claiming their own route was broken.
// Production was healthy the whole time.
//
// Now: these two recording rules read the stream once a minute between them,
// `sum by (request_endpoint)` splits the result, and each controller's alert
// evaluates a PromQL selection over the recorded metric. Prometheus is not
// metered by bytes read, so the number of alert rules no longer appears in the
// bill anywhere.
export const ANY_ERROR_METRIC = 'gp_api:route_errors:count1m'
export const SERVER_ERROR_METRIC = 'gp_api:route_server_errors:count1m'

// A ONE-MINUTE COUNT, RECORDED EVERY MINUTE, and the two numbers have to match.
// A rule's Loki cost is its fetch window divided by its evaluation interval —
// the number of times a day it re-reads the same bytes. At 1:1 each log line is
// read exactly once, which is the floor. The 10-minute window the alerts still
// want is then assembled for free in PromQL with `sum_over_time`, because
// summing ten recorded samples costs nothing.
const ROUTE_RECORDING_WINDOW = '1m'
const ROUTE_RECORDING_INTERVAL_SECONDS = 60

// WHY THE WINDOW ENDS A MINUTE AGO rather than at `now`. Log lines reach Loki
// several seconds after the request they describe: pino hands the line to the
// OTel SDK, `BatchLogRecordProcessor` holds it for up to its scheduled delay,
// and then it is exported. A rule reading [now-60s, now] therefore misses the
// lines from the last few seconds — and, unlike the old 10-minute overlapping
// window, never sees them again, because the next evaluation's window starts
// where this one ended. Reading a window that has already closed costs exactly
// the same and cannot drop anything.
//
// The price is 60s of detection latency, which is the one thing this whole
// change makes worse. It is paid once, not per rule, and it is small against a
// page a human reads minutes later.
//
// If Grafana ever ignores a non-zero `to`, this degrades safely rather than
// breaking: the query becomes an instant evaluation at `now` over a `[1m]`
// vector, which is the same count without the lag.
const ROUTE_RECORDING_LAG_SECONDS = 60

// The label this groups by, named once because the `keep` below has to agree
// with it exactly and a mismatch is silent — `sum by` on a label the vector no
// longer carries collapses all 421 routes into one unlabelled series, and the
// alerts, which match on `request_endpoint`, would then find nothing.
const ROUTE_LABEL = 'request_endpoint'

// WHY THERE IS NO `| json`, AND WHY `keep` IS NOT OPTIONAL.
//
// The fields this filter reads are not in the JSON body as far as Loki is
// concerned. Grafana Cloud promotes OTel log-record attributes to structured
// metadata, so `request_endpoint`, `response_statusCode` and `responseTimeMs`
// are already labels on every line before any parser runs. `| json` therefore
// collided with all three and Loki renamed its output to
// `response_statusCode_extracted` and friends — meaning the filter was reading
// the structured metadata all along and the parser contributed nothing to the
// result. Verified against prod: with and without `| json`, the same 1h window
// returns the identical series, null-status clause included.
//
// What it did contribute is label cardinality. Structured metadata already
// carries `requestId`, `trace_id`, `span_id` and `request_url`, all unique per
// request, and every extracted duplicate added another. That label set is the
// identity of the vector `count_over_time` counts, so the inner vector was
// roughly one series per log line.
//
// `| keep` discards every label but this one, after the filter has used the
// others. That puts the inner cardinality at the number of distinct endpoints
// in the window — 119 across a full unfiltered hour of prod, against a ceiling
// of ROUTE_MAP's 421 plus the handful of no-route sentinels like
// `POST undefined`. It is bounded by the route table rather than by traffic,
// which is the property that matters: it cannot grow under load. Confirmed
// working against our own Grafana Cloud Loki rather than taken from the docs.
//
// This is NOT what Bugbot's `max_query_series` reasoning claimed. That cap
// applies to the series a query RETURNS, and `sum by` already held the result
// to ~100; the unbounded inner vector was measured passing 30k lines without
// erroring. The real cost was per-line parsing and label hashing on a query
// that runs every minute forever, and an inner width set by request volume
// instead of by anything we control.
const routeRecordingExpr = (statusFilter: string) =>
  [
    `sum by (${ROUTE_LABEL}) (count_over_time(`,
    `{service_name="gp-api", deployment_environment_name="$ENV"}`,
    `|= "Request completed"`,
    `| ${statusFilter}`,
    `| keep ${ROUTE_LABEL}`,
    `[${ROUTE_RECORDING_WINDOW}]))`,
  ].join(' ')

/**
 * The two Loki reads that back every generated route alert.
 *
 * Two rather than one because `SERVER_ERRORS_ONLY` controllers apply a
 * different status filter, and LogQL has no conditional that would let one
 * query carry both. Two reads a minute is 2x ingest; the 74 rules they replace
 * were 740x.
 */
export const ROUTE_RECORDING_RULES: RecordingRule[] = [
  {
    slug: 'route-errors',
    name: 'gp-api route errors per minute',
    metric: ANY_ERROR_METRIC,
    expr: routeRecordingExpr(anyErrorFilter),
    fromSeconds: ROUTE_RECORDING_LAG_SECONDS + 60,
    toSeconds: ROUTE_RECORDING_LAG_SECONDS,
    intervalSeconds: ROUTE_RECORDING_INTERVAL_SECONDS,
  },
  {
    slug: 'route-server-errors',
    name: 'gp-api route server errors per minute',
    metric: SERVER_ERROR_METRIC,
    expr: routeRecordingExpr(serverErrorFilter),
    fromSeconds: ROUTE_RECORDING_LAG_SECONDS + 60,
    toSeconds: ROUTE_RECORDING_LAG_SECONDS,
    intervalSeconds: ROUTE_RECORDING_INTERVAL_SECONDS,
  },
]

// The window the alerts judge, unchanged from what the Loki rules used. It is
// now assembled in PromQL from ten recorded samples rather than fetched from
// Loki, so widening it is free — which is exactly why it should still be
// changed deliberately rather than because it became cheap.
const LOOKBACK_RANGE = '10m'
const LOOKBACK_PROSE = '10 minutes'

// The rule counts "Request completed" lines, which carry the status but not
// the cause. The cause is on the exception lines logged for the same request,
// and Loki cannot join the two — so the 2026-09-22 sms/draft page needed a
// Loki session to learn it was a schema reject, not the gateway timeout the
// message warns about. The notification now links straight to those lines
// for the route that fired. Built around a sentinel because the endpoint is a
// Grafana template expanded at fire time (`urlquery` is a Go text/template
// builtin) and must not be URL-encoded with the rest, and `$ENV` is restored
// after encoding so buildAlertDescription still substitutes it. An hour, not
// the 10m window: one error keeps a page open ~20 minutes and it is read
// later still.
//
// This link is now the only Loki query in the route-alerting path, and it runs
// when a human clicks it rather than once a minute forever. That is the shape
// every Loki query here should have.
const GRAFANA_URL = 'https://goodparty.grafana.net'
const LOKI_DATASOURCE_UID = 'grafanacloud-logs'
const ENDPOINT_SENTINEL = '__ENDPOINT__'
const ENDPOINT_TEMPLATE = '{{ $labels.request_endpoint | urlquery }}'

const errorLinesQuery = [
  `{service_name="gp-api", deployment_environment_name="$ENV"}`,
  `|= "${ENDPOINT_SENTINEL}"`,
  '| json',
  `| request_endpoint = "${ENDPOINT_SENTINEL}"`,
  '| exception_type != ""',
].join(' ')

const errorLinesPane = encodeURIComponent(
  JSON.stringify({
    a: {
      datasource: LOKI_DATASOURCE_UID,
      queries: [
        {
          refId: 'A',
          datasource: { uid: LOKI_DATASOURCE_UID },
          expr: errorLinesQuery,
        },
      ],
      range: { from: 'now-1h', to: 'now' },
    },
  }),
)
  .replace(/%24ENV/g, () => '$ENV')
  .split(ENDPOINT_SENTINEL)
  .join(ENDPOINT_TEMPLATE)

const errorLinesLink = `${GRAFANA_URL}/explore?schemaVersion=1&panes=${errorLinesPane}`

/**
 * One controller's routes as a Prometheus label-matcher pattern.
 *
 * TWO LAYERS OF ESCAPING, which is the whole reason this is a named function.
 * The endpoint first has its regex metacharacters escaped, and then those
 * backslashes have to survive being written inside a PromQL double-quoted
 * string, which unescapes `\\` to `\` the way Go does. A single backslash would
 * be an invalid string escape and the rule would not parse.
 *
 * Anchored explicitly even though Prometheus already anchors `=~` on its own:
 * an unanchored `GET /v1/contacts` would swallow `GET /v1/contacts/:id`, and a
 * reader should be able to see that it does not without knowing that rule.
 */
export const promEndpointPattern = (endpoints: readonly string[]): string =>
  `^(?:${endpoints
    .map((endpoint) => endpoint.replace(/[.*+?^${}()|[\]\\]/g, '\\\\$&'))
    .join('|')})$`

export const controllerAlerts = (controller: ControllerName): Alert[] => {
  // Every group that claims this controller, not the first one found. A shared
  // surface is owned by both products, and `find` silently told the second one
  // nothing — the controller was listed under them and they were never tagged.
  const owners = (
    Object.keys(ALERT_OWNERSHIP) as (keyof typeof ALERT_OWNERSHIP)[]
  ).filter((group) => ALERT_OWNERSHIP[group].includes(controller))
  const serverErrorsOnly = SERVER_ERRORS_ONLY.includes(controller)
  const metric = serverErrorsOnly ? SERVER_ERROR_METRIC : ANY_ERROR_METRIC
  const routes = ROUTE_MAP[controller]

  if (routes.length === 0) return []

  // 0 keeps the default "one error pages" for every controller that has not
  // measured a reason to want otherwise. See ROUTE_ERROR_THRESHOLDS.
  const threshold = ROUTE_ERROR_THRESHOLDS[controller] ?? 0

  // Grafana evaluates this as `> threshold`, so on a raised one the message has
  // to say how many it took. Left to the default prose, a rule that needs three
  // errors still reads "returned server errors", and the reader goes looking
  // for the first one — which by then is 10 minutes of logs away from the
  // window that actually fired.
  const countProse = threshold > 0 ? `more than ${threshold} ` : ''

  const endpointPattern = promEndpointPattern(
    routes.map(({ endpoint }) => endpoint),
  )

  // One rule per controller rather than one per route, and the rule reads a
  // recorded metric rather than Loki. `sum by` still returns one series per
  // route and Grafana still turns each series into its own alert instance, so
  // paging stays per-route — the only thing that changed is where the number
  // comes from. See ROUTE_RECORDING_RULES above and docs/observability.md.
  const recordedErrors = [
    `sum by (request_endpoint) (sum_over_time(`,
    `${metric}{environment="$ENV", request_endpoint=~"${endpointPattern}"}`,
    `[${LOOKBACK_RANGE}]))`,
  ].join('')

  return [
    {
      slug: `${controller}-route-errors`,
      name: `[${controller}] Route errors detected`,
      type: 'metric' as const,
      expr: recordedErrors,
      threshold,
      for: '1m',
      // Grafana renders annotations per alert instance, so this is what turns
      // one rule back into a page that names the route that actually broke.
      summaryDetail: '`{{ $labels.request_endpoint }}`',
      message: [
        serverErrorsOnly
          ? `\`{{ $labels.request_endpoint }}\` returned ${countProse}server errors, or no status at all, in the last ${LOOKBACK_PROSE} (status ≥ 500 or null). 4xx responses are deliberately excluded on this controller — see SERVER_ERRORS_ONLY in alerts.ts.`
          : `\`{{ $labels.request_endpoint }}\` returned ${countProse}unexpected error responses, or no status at all, in the last ${LOOKBACK_PROSE} (status ≥ 400 excluding ${EXCLUDED_STATUS_PROSE}, or null).`,
        `<${errorLinesLink}|Open this route's error lines> to read the exception each failing request logged (type, message, stack trace) before deciding what to fix. *View in Grafana* shows only the count that fired.`,
        `A **null** status means gp-api never wrote one: the request was killed in flight, usually by the gateway’s ~120s idle timeout. Only those running longer than ${NO_STATUS_PROSE} are counted — a shorter one is the caller hanging up, which is not a fault and is far more common. Check \`responseTimeMs\` on those lines; a cluster at ~120,000ms is the timeout, not the handler.`,
      ].join('\n\n'),
      notify: owners,
      disabled: owners.length === 0,
    } satisfies Alert,
  ]
}
