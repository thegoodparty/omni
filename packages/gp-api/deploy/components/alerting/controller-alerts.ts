import { ControllerName, ROUTE_MAP } from '../../../src/generated/route-types'
import { Alert, SlackGroup } from './alerts.types'
import { ALERT_OWNERSHIP, SERVER_ERRORS_ONLY } from '../alerts'

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
const EXCLUDED_STATUS_CODES = [400, 401, 403, 404, 409, 498]

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

// These rules take the default `Alert.timeRangeSeconds` (600s), and that fetch
// caps the range vector however wide it is written: the `[1h]` this carried
// only ever saw 10 minutes, while the message promised an hour. Someone
// triaging the 2026-08-20 door-knocking page swept a full hour of logs for
// errors that could only ever have come from the last ten minutes.
//
// Widening the fetch to honor the prose is the other way to close the gap, but
// it would retune the firing and re-fire behavior of every generated route
// alert at once — which the field's own docs say to do deliberately, not in
// passing. So the vector and the prose state the window that actually applies,
// and both read from here so they cannot drift apart again.
const LOOKBACK_RANGE = '10m'
const LOOKBACK_PROSE = '10 minutes'

export const controllerAlerts = (controller: ControllerName): Alert[] => {
  // Every group that claims this controller, not the first one found. A shared
  // surface is owned by both products, and `find` silently told the second one
  // nothing — the controller was listed under them and they were never tagged.
  const owners = (
    Object.keys(ALERT_OWNERSHIP) as (keyof typeof ALERT_OWNERSHIP)[]
  ).filter((group) => ALERT_OWNERSHIP[group].includes(controller))
  const serverErrorsOnly = SERVER_ERRORS_ONLY.includes(controller)
  const statusCodeFilter = serverErrorsOnly ? serverErrorFilter : anyErrorFilter
  const routes = ROUTE_MAP[controller]

  if (routes.length === 0) return []

  // One rule per controller rather than one per route, because Loki bills the
  // bytes a query decompresses and only the stream selector and time range
  // decide that — `|= "Request completed" | json | request_endpoint = ...`
  // all run on data already read and paid for. So a per-route rule cost the
  // same as reading the entire gp-api stream, every owned route re-read that
  // same stream once a minute, and the pile of them is what took us past the
  // 100:1 query-to-ingest allowance and onto a query overage bill. `sum by`
  // reads that stream once and splits the result, and Grafana turns each
  // returned series back into its own alert instance, so paging stays
  // per-route. See docs/observability.md § Query cost.
  //
  // Anchored because an unanchored `GET /v1/contacts` would also swallow
  // `GET /v1/contacts/:id`. A raw string carries the pattern so the escapes
  // below reach Loki's regex engine rather than being eaten as LogQL string
  // escapes; no endpoint contains a backtick to break out of it.
  const endpointPattern = routes
    .map(({ endpoint }) => endpoint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')

  const routeBase = [
    `{service_name="gp-api", deployment_environment_name="$ENV"}`,
    `|= "Request completed"`,
    `| json`,
    `| request_endpoint =~ \`^(?:${endpointPattern})$\``,
  ].join(' ')

  return [
    {
      slug: `${controller}-route-errors`,
      name: `[${controller}] Route errors detected`,
      type: 'log' as const,
      expr: `sum by (request_endpoint) (count_over_time(${routeBase} | ${statusCodeFilter} [${LOOKBACK_RANGE}]))`,
      threshold: 0,
      for: '1m',
      // Grafana renders annotations per alert instance, so this is what turns
      // one rule back into a page that names the route that actually broke.
      summaryDetail: '`{{ $labels.request_endpoint }}`',
      message: [
        serverErrorsOnly
          ? `\`{{ $labels.request_endpoint }}\` returned server errors, or no status at all, in the last ${LOOKBACK_PROSE} (status ≥ 500 or null). 4xx responses are deliberately excluded on this controller — see SERVER_ERRORS_ONLY in alerts.ts.`
          : `\`{{ $labels.request_endpoint }}\` returned unexpected error responses, or no status at all, in the last ${LOOKBACK_PROSE} (status ≥ 400 excluding ${EXCLUDED_STATUS_PROSE}, or null).`,
        'Click *View in Grafana* to find the failing requests, then examine their logs and stack traces to understand why errors are occurring and ship fixes.',
        `A **null** status means gp-api never wrote one: the request was killed in flight, usually by the gateway’s ~120s idle timeout. Only those running longer than ${NO_STATUS_PROSE} are counted — a shorter one is the caller hanging up, which is not a fault and is far more common. Check \`responseTimeMs\` on those lines; a cluster at ~120,000ms is the timeout, not the handler.`,
      ].join('\n\n'),
      notify: owners,
      disabled: owners.length === 0,
    } satisfies Alert,
  ]
}
