import { ControllerName, ROUTE_MAP } from '../../../src/generated/route-types'
import { Alert, SlackGroup } from './alerts.types'
import { ALERT_OWNERSHIP, SERVER_ERRORS_ONLY } from '../alerts'

const EXCLUDED_STATUS_CODES = [401, 403, 404, 409, 498]

// A request the gateway kills mid-flight completes with `statusCode: null`,
// which is neither 4xx nor 5xx — so every status-range filter below misses it
// and the worst failure a route has (no answer at all) paged nobody. Two
// door-knocking pack timeouts in the seven days to 2026-08-25 were invisible
// for exactly this reason. Loki's json parser drops a null field, and a label
// filter reads a missing label as empty, so this is the shape that matches it
// whether the field is absent or empty. It admits no status code at all, and
// therefore none of the 4xx noise SERVER_ERRORS_ONLY exists to suppress.
const noStatusFilter = 'response_statusCode = ""'

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
  const slackGroupName = Object.entries(ALERT_OWNERSHIP).find(
    ([_, controllers]) => controllers.includes(controller),
  )?.[0]
  const serverErrorsOnly = SERVER_ERRORS_ONLY.includes(controller)
  const statusCodeFilter = serverErrorsOnly ? serverErrorFilter : anyErrorFilter
  const routes = ROUTE_MAP[controller]

  return routes.map((route) => {
    const routeBase = `{service_name="gp-api", deployment_environment_name="$ENV"} |= "Request completed" | json | request_endpoint = "${route.endpoint}"`
    const slug = route.endpoint.replace(/[/:]/g, '-').replace(' ', '-')

    return {
      slug: `${slug}-error-count`,
      name: `[${controller}] ${route.endpoint} - Errors detected`,
      type: 'log' as const,
      expr: `sum(count_over_time(${routeBase} | ${statusCodeFilter} [${LOOKBACK_RANGE}]))`,
      threshold: 0,
      for: '1m',
      message: [
        serverErrorsOnly
          ? `\`${route.endpoint}\` returned server errors, or no status at all, in the last ${LOOKBACK_PROSE} (status ≥ 500 or null). 4xx responses are deliberately excluded on this controller — see SERVER_ERRORS_ONLY in alerts.ts.`
          : `\`${route.endpoint}\` returned unexpected error responses, or no status at all, in the last ${LOOKBACK_PROSE} (status ≥ 400 excluding 401/403/404/409/498, or null).`,
        'Click *View in Grafana* to find the failing requests, then examine their logs and stack traces to understand why errors are occurring and ship fixes.',
        'A **null** status means gp-api never wrote one: the request was killed in flight, usually by the gateway’s ~120s idle timeout. Check `responseTimeMs` on those lines — a cluster at ~120,000ms is the timeout, not the handler.',
      ].join('\n\n'),
      // slackGroupName comes from Object.entries find — disabled flag guards undefined case
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      notify: slackGroupName as SlackGroup,
      disabled: !slackGroupName,
    } satisfies Alert
  })
}
