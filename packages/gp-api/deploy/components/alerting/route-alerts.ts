import {
  CONTROLLER_NAMES,
  ControllerName,
  ROUTE_MAP,
} from '../../../src/generated/route-types'
import { Alert, SlackGroup } from './alerts.types'
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
// The six queries that read Loki
// ---------------------------------------------------------------------------

// WHAT REPLACED WHAT, TWICE, because the second attempt is the one that has to
// be understood before anyone moves this again.
//
// Until 2026-09-28 there was one rule per controller: 75 of them, each
// selecting the entire `{service_name="gp-api",
// deployment_environment_name="prod"}` stream and then narrowing to its own
// routes. Loki bills decompressed bytes and only the stream selector and the
// fetch window change that number, so every one of those rules paid for all of
// gp-api's logs in order to look at its slice, once a minute. Measured over the
// 24h to 2026-09-28: 2,690 GB/day from the route rules alone. Grafana Cloud
// started returning 429 and, because `exec_err_state` is `Alerting`
// (deliberately, and it stays), all 154 rules fired at once claiming their own
// route was broken. Production was healthy the whole time.
//
// The fix chosen then was two Grafana-managed recording rules that read Loki
// once a minute and wrote a Prometheus metric every alert could read for free.
// It never wrote a single datapoint. Grafana's recording-rule writer needs a
// wide frame and a Loki instant query returns `timeseries-multi`, which it
// rejects with `unsupported time series type timeseries-multi`. The rules
// reported `health: ok` and `lastError: null` on nearly every poll, because a
// minute after a failed write there is nothing left to write, so nothing looked
// wrong. 168 alert rules across both environments read a metric that did not
// exist, all with `noDataState: OK`, and none of them could fire.
// Cost fell and detection died in the same change.
//
// Now: the alerts read Loki again, but there are six rules rather than 75, and
// each reads exactly the window it judges. The count is what makes it
// affordable — see ROUTE_ALERT_GROUPS.
//
// THE COST RULE, since it is the only thing that decides whether a shape here
// is allowed: a rule's daily read volume, as a multiple of what we ingest, is
// its fetch window divided by its evaluation interval. Gapless coverage needs
// window >= interval, so ONE is the floor for any rule that must not miss
// anything, and the only remaining lever is how many rules there are. 75 rules
// at the floor is 75x ingest; six is six. `global-alerts.test.ts` sums this
// across the estate and fails a PR that spends too much of the allowance.

// The window each rule judges, and the interval it judges it on. Equal, so
// every log line is read exactly once: the floor for a rule that cannot afford
// to miss an error. The 10-minute window is unchanged from what these rules
// have always judged; the interval used to be the 60s default, which re-read
// the same ten minutes ten times over.
//
// The cost of the slower interval is detection latency: an error is seen at
// the next evaluation, so up to ten minutes later. That is accepted for an
// error count. Nothing here is a liveness check — `health-check-probe-failure`
// is, and it is unaffected.
const LOOKBACK_RANGE = '10m'
const LOOKBACK_PROSE = '10 minutes'
const LOOKBACK_SECONDS = 600
export const ROUTE_EVALUATION_SECONDS = 600

// The label the rules group by, named once because the `keep` below has to
// agree with it exactly and a mismatch is silent — `sum by` on a label the
// vector no longer carries collapses every route into one unlabelled series,
// and the notification, which reads `$labels.request_endpoint`, would then
// render an empty route name on every page.
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
// result. Verified against prod: with and without `| json`, the same window
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
// in the window, which is bounded by ROUTE_MAP rather than by traffic — the
// property that matters, since it cannot grow under load.
//
// THE STATUS FILTER RUNS BEFORE THE ENDPOINT REGEX on purpose. Both are label
// filters on structured metadata, so either order returns the same series, but
// the status comparison is a cheap numeric test that discards nearly every
// line, and the endpoint alternation is a regex over a list that can run to a
// hundred entries. Filtering first means the expensive one only ever sees
// errors.
const routeErrorExpr = (statusFilter: string, endpointPattern: string) =>
  [
    `sum by (${ROUTE_LABEL}) (count_over_time(`,
    `{service_name="gp-api", deployment_environment_name="$ENV"}`,
    `|= "Request completed"`,
    `| ${statusFilter}`,
    `| ${ROUTE_LABEL} =~ \`${endpointPattern}\``,
    `| keep ${ROUTE_LABEL}`,
    `[${LOOKBACK_RANGE}]))`,
  ].join(' ')

/**
 * One group's routes as a LogQL label-matcher pattern.
 *
 * Anchored because an unanchored `GET /v1/contacts` would also swallow
 * `GET /v1/contacts/:id`. A raw string carries the pattern into the expression
 * so the escapes here reach Loki's regex engine rather than being eaten as
 * LogQL string escapes; no endpoint contains a backtick to break out of it.
 */
export const routeEndpointPattern = (endpoints: readonly string[]): string =>
  `^(?:${endpoints
    .map((endpoint) => endpoint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')})$`

/**
 * The name and slug fragment for one set of owners.
 *
 * A closed map rather than something derived from the group names, because the
 * slug is the alert's identity in Grafana and in the routing snapshot: deriving
 * it would let a rename of a Slack group silently retire every alert under it
 * and create a new one with no history. `routeAlertGroups` throws on a
 * combination that is not listed, so adding a third product is a deploy-time
 * failure rather than a rule that quietly stops being provisioned.
 */
const OWNER_NAMING: Record<string, { slug: string; label: string }> = {
  'serve-bugs': { slug: 'serve', label: 'Serve' },
  'win-bugs': { slug: 'win', label: 'Win' },
  'serve-bugs,win-bugs': { slug: 'shared', label: 'Shared' },
}

export type RouteAlertGroup = {
  slug: string
  label: string
  owners: SlackGroup[]
  serverErrorsOnly: boolean
  threshold: number
  controllers: ControllerName[]
  endpoints: string[]
}

/**
 * Every controller that gets a route alert, bucketed into the smallest number
 * of Loki rules that can still say the right thing.
 *
 * WHY GROUPING IS SAFE, which is the question to ask first. Only three things
 * ever varied between the 75 per-controller rules: who is notified, which
 * status filter applies (`SERVER_ERRORS_ONLY`), and how many errors it takes
 * (`ROUTE_ERROR_THRESHOLDS`). Every one of those is a property of the rule, not
 * of the series it returns, so controllers that agree on all three can share a
 * rule without any of them changing meaning. The endpoint alternation is what
 * keeps them apart.
 *
 * PAGING STAYS PER-ROUTE. `sum by (request_endpoint)` returns one series per
 * route, Grafana turns each returned series into its own alert instance, and
 * `summaryDetail` puts the endpoint in the title. A grouped rule pages exactly
 * as a per-controller rule did; what it no longer does is name the controller,
 * which the endpoint already implies.
 *
 * WHAT IS GENUINELY LOST: the Grafana rule name no longer carries
 * `[controller]`, and 75 alert slugs become six. Alert history and any silence
 * keyed to an old slug do not survive that. The routing policy is unaffected —
 * it matches on `environment`, not on slug.
 *
 * A controller with no owner is not in here at all, rather than provisioned
 * paused. `CONTROLLERS_WITHOUT_ROUTE_ALERTS` documents which ones and why.
 */
export const routeAlertGroups = (): RouteAlertGroup[] => {
  const groups = new Map<string, RouteAlertGroup>()

  for (const controller of CONTROLLER_NAMES) {
    // Every group that claims this controller, not the first one found. A
    // shared surface is owned by both products, and `find` silently told the
    // second one nothing — the controller was listed under them and they were
    // never tagged.
    const owners = (
      Object.keys(ALERT_OWNERSHIP) as (keyof typeof ALERT_OWNERSHIP)[]
    ).filter((group) => ALERT_OWNERSHIP[group].includes(controller))

    if (owners.length === 0) continue

    const routes = ROUTE_MAP[controller]
    if (routes.length === 0) continue

    const serverErrorsOnly = SERVER_ERRORS_ONLY.includes(controller)
    // 0 keeps the default "one error pages" for every controller that has not
    // measured a reason to want otherwise. See ROUTE_ERROR_THRESHOLDS.
    const threshold = ROUTE_ERROR_THRESHOLDS[controller] ?? 0

    const naming = OWNER_NAMING[owners.join(',')]
    if (!naming) {
      throw new Error(
        `No slug is registered for the owner set ${owners.join(', ')}. ` +
          `Add one to OWNER_NAMING in alerting/route-alerts.ts.`,
      )
    }

    const slug = [
      'route-errors',
      naming.slug,
      serverErrorsOnly ? 'server-errors' : null,
      threshold > 0 ? `min${threshold}` : null,
    ]
      .filter((part) => part !== null)
      .join('-')

    const existing = groups.get(slug)
    if (existing) {
      existing.controllers.push(controller)
      existing.endpoints.push(...routes.map(({ endpoint }) => endpoint))
      continue
    }

    groups.set(slug, {
      slug,
      label: naming.label,
      owners,
      serverErrorsOnly,
      threshold,
      controllers: [controller],
      endpoints: routes.map(({ endpoint }) => endpoint),
    })
  }

  // Sorted so the provisioned order is a property of the definitions rather
  // than of CONTROLLER_NAMES, which is generated from the src tree and reorders
  // whenever a controller is added.
  //
  // Endpoints deduplicated because ROUTE_MAP can carry one twice: `contacts`
  // declares `GET /v1/contacts/:id` on two handlers today. A repeat in the
  // alternation matches identically, so this is legibility rather than
  // correctness — but a reader who finds the same route listed twice in a rule
  // will go looking for the reason, and there isn't one.
  return [...groups.values()]
    .map((group) => ({ ...group, endpoints: [...new Set(group.endpoints)] }))
    .sort((a, b) => a.slug.localeCompare(b.slug))
}

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
 * The six rules that watch every owned route for errors.
 *
 * `noDataState` stays `OK` on these and that is now the correct answer rather
 * than a compromise. A Loki rule that finds no error lines genuinely returns no
 * data, on nearly every route on nearly every evaluation; a Loki rule whose
 * query is broken raises an execution error, which `execErrState: 'Alerting'`
 * pages on. The two are distinguishable again. They were not while these
 * alerts read a Prometheus metric, because PromQL answers a missing metric and
 * a healthy route with the same empty result — which is exactly how a total
 * alerting outage looked exactly like silence.
 */
export const routeErrorAlerts = (): Alert[] =>
  routeAlertGroups().map((group) => {
    const statusFilter = group.serverErrorsOnly
      ? serverErrorFilter
      : anyErrorFilter

    // Grafana evaluates this as `> threshold`, so on a raised one the message
    // has to say how many it took. Left to the default prose, a rule that needs
    // three errors still reads "returned server errors", and the reader goes
    // looking for the first one — which by then is 10 minutes of logs away from
    // the window that actually fired.
    const countProse =
      group.threshold > 0 ? `more than ${group.threshold} ` : ''

    const qualifier = [
      group.serverErrorsOnly ? 'server errors only' : null,
      group.threshold > 0 ? `more than ${group.threshold}` : null,
    ].filter((part) => part !== null)

    return {
      slug: group.slug,
      name: `[${group.label}] Route errors detected${
        qualifier.length > 0 ? ` (${qualifier.join(', ')})` : ''
      }`,
      type: 'log' as const,
      expr: routeErrorExpr(statusFilter, routeEndpointPattern(group.endpoints)),
      threshold: group.threshold,
      // Zero, not one minute, because `for` is counted in whole evaluations and
      // the interval below is ten of them. A `for` of '1m' would not mean a
      // minute here; it would mean the rule has to breach on two consecutive
      // evaluations, so up to twenty minutes before anyone hears. The 10-minute
      // window is already the debounce.
      for: '0m',
      // Grafana renders annotations per alert instance, so this is what turns
      // one rule back into a page that names the route that actually broke.
      summaryDetail: '`{{ $labels.request_endpoint }}`',
      timeRangeSeconds: LOOKBACK_SECONDS,
      evaluationIntervalSeconds: ROUTE_EVALUATION_SECONDS,
      message: [
        group.serverErrorsOnly
          ? `\`{{ $labels.request_endpoint }}\` returned ${countProse}server errors, or no status at all, in the last ${LOOKBACK_PROSE} (status ≥ 500 or null). 4xx responses are deliberately excluded on this route's controller — see SERVER_ERRORS_ONLY in alerts.ts.`
          : `\`{{ $labels.request_endpoint }}\` returned ${countProse}unexpected error responses, or no status at all, in the last ${LOOKBACK_PROSE} (status ≥ 400 excluding ${EXCLUDED_STATUS_PROSE}, or null).`,
        `<${errorLinesLink}|Open this route's error lines> to read the exception each failing request logged (type, message, stack trace) before deciding what to fix. *View in Grafana* shows only the count that fired.`,
        `A **null** status means gp-api never wrote one: the request was killed in flight, usually by the gateway’s ~120s idle timeout. Only those running longer than ${NO_STATUS_PROSE} are counted — a shorter one is the caller hanging up, which is not a fault and is far more common. Check \`responseTimeMs\` on those lines; a cluster at ~120,000ms is the timeout, not the handler.`,
      ].join('\n\n'),
      notify: group.owners,
    } satisfies Alert
  })
