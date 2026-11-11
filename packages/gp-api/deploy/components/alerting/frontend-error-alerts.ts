import { Alert } from './alerts.types'

/**
 * Browser errors from gp-webapp, as Grafana Frontend Observability (Faro)
 * stores them in Loki: one logfmt line per exception on the
 * `{service_name="gp-webapp-$ENV", kind="exception"}` stream, carrying
 * `app_environment`, `type`, `value` (the message), `session_id` and the
 * stack trace. `service_name` is the Frontend Observability app's name
 * (`gp-webapp-prod`, `gp-webapp-dev`), not the SDK's `app.name`. The dev app
 * also takes PR previews, so `app_environment` still narrows to the alert's
 * own environment.
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
 * own budget is in frontend-error-alerts.test.ts. The stream is small: the
 * previous error tracker recorded about 85 issues in the 30 days to
 * 2026-11-04, and Faro wrote 85 exception lines to this stream in the 7 days
 * to 2026-11-11, of which these two rules count 9. See
 * {@link SHIPPED_CODE_FRAMES} for what the rest were.
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
 * A stack frame from code we ship: a frame the browser points at one of our
 * built chunks (`/_next/static/…`), or at the source-mapped path Faro
 * resolves it to (`turbopack:///…`, the Next 16 build).
 *
 * THIS IS A POSITIVE FILTER, and that is the point. A rule can carry a list
 * of things that are not ours — an extension scheme, a fetch wording, a tag
 * runtime — and that list has no end: every browser release and every
 * extension adds one, and each one pages a human until somebody widens the
 * list. "A frame in the build we just shipped" is instead a property we can
 * test, and everything that fails it is by definition not a bug we can fix.
 * What fails it:
 *
 * - a script injected into the page by the browser or an extension. It runs
 *   in the page's own context, so its frame is the DOCUMENT URL with a
 *   synthetic line and column (`at global code (https://app.goodparty.org/
 *   dashboard:1:16)`), not `chrome-extension://`. Brave's wallet injector on
 *   iOS did exactly that 12 times in one session on 2026-11-11, and every one
 *   of them looked like a new error in our own code.
 * - a cross-origin script error, which browsers redact to `Script error.`
 *   with a single `:0:0` frame on the document URL. 27 of the 85 lines in the
 *   week to 2026-11-11.
 * - a third-party tag runtime loaded by our analytics snippet, which frames at
 *   its own bundle (27 of the 85: Google Tag Manager's `gtag` failing to
 *   load).
 * - an exception Faro recorded with no stack at all, which has no frame for a
 *   reader to act on anyway.
 *
 * The cost: an error thrown by inline script in our own HTML has no chunk
 * frame and is dropped with them. Nothing in the stream above came from
 * inline code, and gp-webapp's app code is all chunks.
 *
 * RE2 syntax, sent inside the double-quoted LogQL string below. It is a line
 * filter, so it searches the whole line rather than matching the parsed
 * `stacktrace` value whole — which also keeps a chunk-load failure whose
 * MESSAGE names an `/_next/static/` URL while its stack does not, the safe
 * direction to be wrong in.
 */
export const SHIPPED_CODE_FRAMES = 'turbopack:///|/_next/static/'

/**
 * Every prod exception that is ours, with the group and session as labels.
 * The frame filter is a line filter, applied before parsing, because the frame
 * can sit anywhere in the stack trace.
 */
const ourExceptions = (keep: string) =>
  [
    '{service_name="gp-webapp-$ENV", kind="exception"}',
    `|~ "${SHIPPED_CODE_FRAMES}"`,
    '| logfmt app_environment, type, value, session_id',
    '| app_environment = "$ENV"',
    `| value !~ \`(?i)${NETWORK_FAILURE_MESSAGES}\``,
    '| label_format error_type=type',
    '| label_format error_message=`{{ trunc 200 .value }}`',
    `| keep ${keep}`,
  ].join(' ')

const FIND_IT = [
  'Open Frontend Observability in Grafana (gp-webapp-prod app), Errors tab, and search for the message; the stack trace there is source-mapped.',
  'Or in Explore, on `grafanacloud-logs`: `{service_name="gp-webapp-prod", kind="exception"} | logfmt | app_environment="prod"` and filter on the message.',
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
      'One browser error reached **3 or more user sessions in the last hour** in prod, network failures and errors thrown by code we do not ship aside.',
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
      'A browser error showed up in prod in the last hour that had not been seen in the 7 days before, network failures and errors thrown by code we do not ship aside.',
      FIND_IT,
    ].join('\n\n'),
  },
]
