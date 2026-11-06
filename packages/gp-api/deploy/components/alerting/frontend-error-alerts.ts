import { Alert } from './alerts.types'

/**
 * Browser errors from gp-webapp, as Grafana Frontend Observability (Faro)
 * stores them in Loki: one logfmt line per exception on the
 * `{service_name="gp-webapp", kind="exception"}` stream, carrying
 * `app_environment`, `type`, `value` (the message), `session_id` and the
 * stack trace. Both environments' Faro apps write to that stream, so the
 * environment is a parsed field here, not a stream label.
 *
 * AN ERROR GROUP IS ITS TYPE AND MESSAGE. That is what Faro's own exception
 * `hash` is computed from, and both come back as labels on every alert
 * instance (`error_type`, `error_message`), so one firing per group reaches
 * the dev-alerts webhook with labels Delegate can file and dedup one ticket
 * on. The policy tree groups notifications by `alert_slug` (and
 * `request_endpoint`, which these do not carry), so two groups firing in the
 * same window arrive in one delivery as two alerts, each with its own labels.
 *
 * NOT A STREAM SHARED WITH gp-api, so these sit outside the gp-api budget in
 * global-alerts.test.ts, which counts days of the gp-api prod stream. Their
 * own budget is in frontend-error-alerts.test.ts. The stream is small: about
 * 85 Sentry issues in the 30 days to 2026-11-04, most of them noise this
 * query drops.
 */

/**
 * Messages a browser gives a fetch that never got an answer: the network
 * dropped, the tab navigated away, a blocker refused it. Chrome, Safari,
 * Firefox and React Native's wording in turn, with Chrome's optional
 * `(<host>)` suffix. Anchored, so `Failed to fetch dynamically imported
 * module` (a chunk that no longer exists after a deploy) still counts.
 *
 * RE2 syntax, matched case-insensitively and sent as a raw (backtick)
 * LogQL string, so the backslashes reach Loki as written. Exported so the tests can check it
 * against the messages it is meant to drop and keep.
 */
export const NETWORK_FAILURE_MESSAGES =
  '^(failed to fetch|load failed|networkerror when attempting to fetch resource\\.?|network request failed)( \\(.*\\))?$'

/**
 * A stack frame from a browser extension: an error thrown by code we do not
 * ship, on a page it injected itself into.
 */
export const EXTENSION_FRAMES = '(chrome|moz|safari|safari-web)-extension://'

/**
 * Every prod exception that is ours, with the group and session as labels.
 * The extension filter is a line filter, applied before parsing, because the
 * frame can sit anywhere in the stack trace.
 */
const ourExceptions = (keep: string) =>
  [
    '{service_name="gp-webapp", kind="exception"}',
    `!~ "${EXTENSION_FRAMES}"`,
    '| logfmt app_environment, type, value, session_id',
    '| app_environment = "$ENV"',
    `| value !~ \`(?i)${NETWORK_FAILURE_MESSAGES}\``,
    '| label_format error_type=type',
    '| label_format error_message=`{{ trunc 200 .value }}`',
    `| keep ${keep}`,
  ].join(' ')

const FIND_IT = [
  'Open Frontend Observability in Grafana (gp-webapp-prod app), Errors tab, and search for the message; the stack trace there is source-mapped.',
  'Or in Explore, on `grafanacloud-logs`: `{service_name="gp-webapp", kind="exception"} | logfmt | app_environment="prod"` and filter on the message.',
].join(' ')

export const FRONTEND_ERROR_ALERTS: Alert[] = [
  {
    slug: 'frontend-error-spreading',
    name: 'Front-end error hitting several users',
    type: 'log',
    // Distinct sessions per group: the inner sum is one series per session
    // that saw the group, and `count` counts those.
    expr: [
      'count by (error_type, error_message) (',
      'sum by (error_type, error_message, session_id) (',
      `count_over_time(${ourExceptions('error_type, error_message, session_id')} [1h])`,
      '))',
    ].join(' '),
    // Three sessions. The 2026-11-04 incident was one existing error,
    // "Connection closed", reaching 3 users on /dashboard/priorities inside
    // 90 seconds; one user hitting it repeatedly is a bug report, not this.
    threshold: 2,
    for: '0m',
    timeRangeSeconds: 3600,
    evaluationIntervalSeconds: 300,
    summaryDetail: '`{{ $labels.error_message }}`',
    message: [
      'One browser error reached **3 or more user sessions in the last hour** in prod, network failures and browser-extension errors aside.',
      FIND_IT,
    ].join('\n\n'),
  },
  {
    slug: 'frontend-error-new',
    name: 'New front-end error in prod',
    type: 'log',
    // Seen this hour and not in the week before it. `unless` matches on the
    // full label set, which is the group on both sides.
    expr: [
      `sum by (error_type, error_message) (count_over_time(${ourExceptions('error_type, error_message')} [1h]))`,
      'unless',
      `sum by (error_type, error_message) (count_over_time(${ourExceptions('error_type, error_message')} [7d] offset 1h))`,
    ].join(' '),
    threshold: 0,
    for: '0m',
    timeRangeSeconds: 3600,
    // Hourly: a new error files a ticket rather than paging, so an hour of
    // latency costs nothing, and every evaluation reads the whole week.
    evaluationIntervalSeconds: 3600,
    // Faro lines reach Loki a few seconds after the error. Ending the window
    // a minute back means the next hour's window, not neither, sees a line
    // that arrived late.
    timeRangeOffsetSeconds: 60,
    summaryDetail: '`{{ $labels.error_message }}`',
    message: [
      'A browser error showed up in prod in the last hour that had not been seen in the 7 days before, network failures and browser-extension errors aside.',
      FIND_IT,
    ].join('\n\n'),
  },
]
