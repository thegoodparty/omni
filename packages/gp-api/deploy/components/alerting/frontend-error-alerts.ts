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
 * 2026-11-04, most of them noise this query drops.
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
 * The DOM's own wording when the node `insertBefore` or `removeChild` is given
 * is not where its caller's tree says it is: `Failed to execute 'insertBefore'
 * on 'Node': The node before which the new node is to be inserted is not a
 * child of this node.`, and `removeChild`'s `The node to be removed is not a
 * child of this node.` The phrase is the DOM standard's, so Chrome, Firefox and
 * Safari all produce it and there is no second wording to add later.
 *
 * THE CAUSE IS NEVER OUR CODE. react-dom passes `insertBefore` the sibling it
 * committed for that parent, so the call only fails once something outside
 * React has moved, wrapped or replaced that node. The throw site is in our
 * bundle, react-dom being a dependency, which is why the frame filters keep
 * it, but the frame says where the DOM refused, not what made the tree stale.
 *
 * On 2026-11-11T05:27:07Z, on /onboarding/office-selection, the cause was
 * Chrome translating the page: `browser_language=ko-KR` on `<html lang="en">`
 * content. The session's own ad-tech hits report `document.title` as our
 * English `Candidate Onboarding | GoodParty.org` at 05:25:54Z and as the
 * Korean translation of our root title at 05:27:13Z, so the DOM text was
 * rewritten between the two and the exception falls in that window. gp-webapp
 * ships no Korean string and has no locale layer, so only the browser
 * rewrote it. Nothing in our code can prevent that, no component appears in
 * the stack to fix, and the user was not harmed: the same session went on to
 * /dashboard/profile and 140 more events. React also offers no way to resync a
 * mutation it did not make (facebook/react#11538), and every browser
 * translation feature rewrites text nodes the same way, so the rule drops the
 * class instead of filing a ticket nobody can close.
 *
 * The cost: a `createPortal` into a node our own code found in the DOM
 * (`app/dashboard/shared/StepFooter.tsx`,
 * `app/dashboard/shared/DashboardNavHeaderAction.tsx`) would be dropped too.
 * Neither has produced one of these in the 29 days the stream covers.
 *
 * The `.*` on both ends are load-bearing: Loki anchors a label-match regex to
 * the whole value, so unlike the line filters above this is not a substring
 * search, and `NETWORK_FAILURE_MESSAGES` anchors on purpose for the same
 * reason. Verified against the prod stream at the 2026-11-11T05:42Z
 * evaluation: with this filter the rule returns no series, without it the one
 * `NotFoundError` group above.
 */
export const DOM_MUTATION_MESSAGES = '.*is not a child of this node.*'

/**
 * A stack frame from a browser extension: an error thrown by code we do not
 * ship, on a page it injected itself into.
 */
export const EXTENSION_FRAMES = '(chrome|moz|safari|safari-web)-extension://'

/**
 * Every prod exception that is ours, with the group and session as labels.
 * The extension filter is a line filter, applied before parsing, because the
 * frame can sit anywhere in the stack trace. The two message filters run after
 * it, on the parsed value, and drop two things a stack cannot tell apart from
 * ours: a fetch the browser refused, and a DOM mutation a browser made under
 * react-dom.
 */
const ourExceptions = (keep: string) =>
  [
    '{service_name="gp-webapp-$ENV", kind="exception"}',
    `!~ "${EXTENSION_FRAMES}"`,
    '| logfmt app_environment, type, value, session_id',
    '| app_environment = "$ENV"',
    `| value !~ \`(?i)${NETWORK_FAILURE_MESSAGES}\``,
    `| value !~ \`(?i)${DOM_MUTATION_MESSAGES}\``,
    '| label_format error_type=type',
    '| label_format error_message=`{{ trunc 200 .value }}`',
    `| keep ${keep}`,
  ].join(' ')

const FIND_IT = [
  'Open Frontend Observability in Grafana (gp-webapp-prod app), Errors tab, and search for the message; the stack trace there is source-mapped.',
  'Or in Explore, on `grafanacloud-logs`: `{service_name="gp-webapp-prod", kind="exception"} | logfmt | app_environment="prod"` and filter on the message.',
].join(' ')

const NOT_COUNTED =
  'Not counted here: a network failure, a browser-extension error, and the DOM "is not a child of this node" error, which means a browser feature (auto-translate, an extension, autofill) rewrote the page under React. None of the three is fixed by a change to our code.'

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
      NOT_COUNTED,
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
      NOT_COUNTED,
    ].join('\n\n'),
  },
]
