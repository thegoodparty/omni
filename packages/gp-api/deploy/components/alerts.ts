import { ControllerName } from '../../src/generated/route-types'
import { Alert, SlackGroup } from './alerting/alerts.types'
import { geoapifyBudgetAlerts } from './alerting/geoapify-budget-alerts'

/**
 * Which product's users each controller serves, and therefore who hears about
 * it when it breaks.
 *
 * Being in here is what enables a controller's generated route alert at all —
 * `controllerAlerts` ends with `disabled: !owners.length`. That has been true
 * since 2026-03-01, and the map was seeded on 2026-03-05 with five `serve-bugs`
 * entries and an empty `win-bugs`. It gained exactly one entry in the six months
 * after, while gp-api went from 40 `@Controller` decorators to 99 — so what used
 * to be here was not a set of decisions about what needs watching, it was where
 * two teams happened to opt in once. 320 of 382 routes could not report their
 * own failure, which is how GET /v1/public-person-profiles/voter-density served
 * 1,498,324 consecutive 500s over four days without paging anyone.
 *
 * One line per controller, rather than two lists to keep in sync: a fifth of
 * these are owned by both products, and expressing that as membership in two
 * arrays means 22 entries duplicated by hand. ALERT_OWNERSHIP is derived below
 * and keeps its old shape, so nothing downstream changes.
 *
 * `BOTH` is the honest answer for a shared surface, not a hedge. Auth, users,
 * payments and elections are used by both products, and naming one owner means
 * the other finds out second-hand. It is also the safe direction to be wrong in:
 * over-tagging costs someone a glance, under-tagging costs an outage.
 *
 * The assignments come from guards and module docs rather than from names —
 * `@UseCampaign()` for Win, `@UseElectedOffice()` for Serve, an explicit `eo-`
 * organization rejection, or an AGENTS.md that says outright who a feature is
 * for. Three are weaker and worth revisiting if they ever page the wrong team:
 * `content` (mixed content types, no webapp caller), `subscribe` (no caller in
 * the monorepo at all — presumably the marketing site), and the two public
 * controllers, whose callers live in gp-marketing.
 *
 * The group split is itself on the way out — it is one team now, and a single
 * rotation is wanted. That is deliberately NOT done here, because it changes
 * who is paged for everything in one commit. Until then, which key a controller
 * sits under matters less than that it sits under one.
 */
const SERVE = 'serve-bugs' satisfies SlackGroup
const WIN = 'win-bugs' satisfies SlackGroup
const BOTH = [SERVE, WIN] satisfies SlackGroup[]

const CONTROLLER_OWNERS: Partial<
  Record<ControllerName, readonly SlackGroup[]>
> = {
  // Serve — officeholders governing. Almost all of these carry
  // `@UseElectedOffice()`; the briefing, ordinance and annotation surfaces are
  // the Chief of Staff product.
  'elected-office': [SERVE],
  polls: [SERVE],
  contacts: [SERVE],
  'contact-engagement': [SERVE],
  organizations: [SERVE],
  'dashboard/cards': [SERVE],
  'dashboard/onboarding-cards': [SERVE],
  'organizations/:slug/ordinance-code': [SERVE],
  'outreach/serve': [SERVE],
  priorities: [SERVE],
  'admin/briefings': [SERVE],
  'admin/elected-office': [SERVE],
  annotations: [SERVE],
  'meetings/:date/briefing/annotations': [SERVE],
  'ordinances/:slug/annotations': [SERVE],
  'meetings/:date/briefing/feedback': [SERVE],
  'meetings/:date/briefing/items/:itemId/feedback': [SERVE],
  'meetings/:date/briefing/review-verdict': [SERVE],
  'community-issues': [SERVE],
  briefings: [SERVE],
  meetings: [SERVE],
  ordinances: [SERVE],
  'briefing-chats': [SERVE],
  speech: [SERVE],

  // Win — candidates campaigning. `@UseCampaign()`, a CampaignOwner guard, or a
  // Prisma model that only relates to `Campaign`.
  'door-knocking': [WIN],
  campaigns: [WIN],
  'campaign-plan-shares': [WIN],
  'campaigns/mine/story': [WIN],
  campaignStrategy: [WIN],
  crm: [WIN],
  'organizations/team': [WIN],
  outreach: [WIN],
  'outreach/admin/sms': [WIN],
  'campaigns/mine/race-opponent': [WIN],
  'campaigns/mine/recommended-lists': [WIN],
  'campaigns/tracker-tasks': [WIN],
  'campaigns/:id/positions': [WIN],
  'campaigns/tasks': [WIN],
  'campaigns/tcr-compliance': [WIN],
  'campaigns/mine/update-history': [WIN],
  'admin/campaign': [WIN],
  'admin/campaigns': [WIN],
  positions: [WIN],
  ecanvasser: [WIN],
  p2p: [WIN],
  domains: [WIN],
  websites: [WIN],
  'campaigns/ai/chat': [WIN],
  'campaigns/ai': [WIN],

  // Shared. Platform surfaces, onboarding steps both flows render, and the two
  // dual-product profile features.
  authentication: BOTH,
  content: BOTH,
  elections: BOTH,
  experiment: BOTH,
  'onboarding/contacts': BOTH,
  'onboarding/local-news': BOTH,
  'onboarding/voter-issues': BOTH,
  payments: BOTH,
  'payments/purchase': BOTH,
  'phone-banking': BOTH,
  subscribe: BOTH,
  'top-issues': BOTH,
  users: BOTH,
  'admin/agent-runs': BOTH,
  'admin/users': BOTH,
  eligibility: BOTH,
  'person-profiles': BOTH,
  'public-person-profiles': BOTH,
  'public-campaigns': BOTH,
  'speech/transcribe': BOTH,
  'voters/voter-file': BOTH,
  chats: BOTH,
  'error-logger': BOTH,
}

const ownedBy = (group: SlackGroup): ControllerName[] =>
  (Object.keys(CONTROLLER_OWNERS) as ControllerName[]).filter((controller) =>
    CONTROLLER_OWNERS[controller]?.includes(group),
  )

/** Map of slack group to controllers, derived from {@link CONTROLLER_OWNERS}. */
export const ALERT_OWNERSHIP: Record<SlackGroup, ControllerName[]> = {
  'serve-bugs': ownedBy(SERVE),
  'win-bugs': ownedBy(WIN),
}

/**
 * Controllers deliberately left without a route alert.
 *
 * Every other controller is now owned in CONTROLLER_OWNERS above. This list is
 * what is left over, and it is short on purpose — each entry is a claim that
 * failure here is not worth waking anyone for, and the tests make a new
 * controller land in one place or the other rather than defaulting to silence.
 *
 * `health` is covered better elsewhere. `health-check-probe-failure` watches it
 * with a synthetic probe from outside, which tests reachability rather than just
 * whether the handler threw, so a log-based route alert on the same endpoint
 * would duplicate it and add nothing.
 *
 * `test-fixtures` returns 404 outside dev and preview, so prod traffic to it is
 * by definition not ours; paging on it means paging for a broken test, which CI
 * already reports.
 *
 * `version` echoes the build version and `queue` is a method literally named
 * `testQueue()` that enqueues a hardcoded `test-slug` — a development poke, not
 * a product route. Nothing downstream depends on either answering.
 *
 * `mcp` is here for a different reason: it has no entries in ROUTE_MAP, so
 * `controllerAlerts` returns nothing for it and there is no rule to enable. It
 * is listed so the coverage test can account for it, not because a decision was
 * made about it. That it serves real traffic — 19 no-status timeouts on
 * POST /v1/mcp in prod over 30 days — while being invisible to the route-type
 * generator is a separate gap, and one this list cannot close.
 */
export const CONTROLLERS_WITHOUT_ROUTE_ALERTS: ControllerName[] = [
  'health',
  'test-fixtures',
  'version',
  'queue',
  'mcp',
]

/**
 * Controllers whose generated route alerts fire on 5xx only.
 *
 * The default filter calls every status >= 400 outside the excluded list a
 * fault. That is right for a controller whose 4xx responses are all bugs and
 * wrong for one whose 4xx responses are the feature working: door knocking
 * answers an over-budget knock with 429, which that filter counts. Under the
 * default rule normal pilot use would page, and an alert that fires on
 * designed behavior gets muted.
 *
 * This list needs to carry less than it used to. Door knocking's other
 * designed 4xx — an empty or oversized turf, an ineligible district the
 * webapp renders as a state, a turf holding an address the road network
 * cannot reach — are 400s, and EXCLUDED_STATUS_CODES now drops those on every
 * controller. 429 is what still requires the entry. A controller whose only
 * designed 4xx is a 400 does not belong here.
 *
 * What is worth waking someone for is the 5xx range: a missing
 * GEOAPIFY_API_KEY (502), a Route Planner outage (502), and unhandled 500s. A
 * plan that skips a stop is NOT in that range any more — the vendor is
 * working and the turf is the problem, so it answers 400 naming the address.
 * Its only trace is the `door-knocking turf contains stops the route planner
 * cannot reach` warn line, which is deliberate: it is a data fix, not a page.
 *
 * And, since 2026-08-25, a completion with NO status — see `noStatusFilter` in
 * alerting/controller-alerts.ts. That is a request gp-api never answered, so
 * it is a fault on any controller and it carries none of the 4xx noise this
 * list exists to suppress.
 *
 * The cost is real — a genuine bug that surfaces as a 4xx on these
 * controllers no longer pages, and nothing here can tell a designed 429 from
 * an accidental one. So add a controller only when its 4xx vocabulary is
 * deliberate and documented; every other controller keeps the >= 400 rule.
 *
 * `contacts` was measured against 30 days of dev logs before being added, and
 * its entire counted 4xx vocabulary is three deliberate gates, all raised as
 * `BadRequestException` from `HttpExceptionFilter`:
 *
 *   843  "Filtering voter data is only available for pro campaigns"
 *   230  "Precinct filtering is not available for this organization"
 *    75  "This feature is only available for pro campaigns"
 *
 * against 9 genuine 5xx in the same window (two 500s, seven 504s), which this
 * keeps. Those 1148 gate responses were driving `contacts-route-errors` to 344
 * firings in 30 days — the single largest source of alert traffic in the
 * estate, and all of it a pro gate refusing non-pro test traffic correctly.
 *
 * TWO CONTROLLERS WERE MEASURED AND DELIBERATELY LEFT OUT, because they look
 * like they belong here and do not:
 *
 *   `elected-office` fires on 197 responses that are 400 to a client and a
 *   server fault in fact: `PrismaExceptionFilter` maps P2028 (interactive
 *   transaction expired, 5000ms budget) onto 400, so `POST /v1/elected-office`
 *   reports a database timeout as a bad request. Adding it here would silence
 *   197 real bugs. The misclassification is the thing to fix.
 *
 *   `organizations` has NO counted 4xx at all — its 76 firings are Clerk 502s.
 *   Adding it would change nothing today while telling the next reader its 4xx
 *   had been reviewed and found deliberate.
 */
export const SERVER_ERRORS_ONLY: ControllerName[] = [
  'door-knocking',
  'contacts',
]

export const GLOBAL_ALERTS: Alert[] = [
  // ------ Global Shared Alerts ------ //
  {
    slug: 'high-cpu',
    name: 'High CPU utilization',
    type: 'metric',
    expr: 'avg(process_cpu_utilization{service_name="gp-api", deployment_environment_name="$ENV"}) * 100',
    threshold: 80,
    for: '5m',
    message: [
      'Process CPU utilization has exceeded 80% for 5 minutes.',
      'Click *View in Grafana* to check the CPU & Memory dashboard, and look for recent deployments or traffic spikes that may be driving the increase. If sustained, consider scaling up the service or profiling for hot code paths.',
    ].join('\n\n'),
  },
  {
    slug: 'high-memory',
    name: 'High memory utilization',
    type: 'metric',
    expr: 'avg(system_memory_utilization{service_name="gp-api", deployment_environment_name="$ENV", system_memory_state="used"}) * 100',
    threshold: 90,
    for: '5m',
    message: [
      'System memory utilization has exceeded 90% for 5 minutes.',
      'Click *View in Grafana* to check memory trends on the CPU & Memory dashboard. Look for memory leaks (steadily climbing usage) or a recent deployment that increased baseline consumption. If the service is at risk of OOM, consider restarting it and then investigating the root cause.',
    ].join('\n\n'),
  },
  {
    slug: 'health-check-probe-failure',
    name: 'Health check probe failures',
    type: 'metric',
    expr: '1 - (sum(rate(probe_all_success_sum{job="gp-api-$ENV-health"}[5m])) / sum(rate(probe_all_success_count{job="gp-api-$ENV-health"}[5m])))',
    threshold: 0.1,
    for: '2m',
    message:
      'Synthetic monitoring probes are failing against the health endpoint — the service may be unreachable externally.',
  },
  // ------ Serve Alerts ------ //
  {
    slug: 'serve-background-job-failed',
    name: '[Serve] Background job failed',
    type: 'log',
    // Poll-job failures only. The consumer logs the SQS message in
    // message_Body; match its `type` (pollCreation / pollExpansion /
    // pollAnalysisComplete) so sibling jobs that share the consumer (AI
    // content, websites) don't page the serve-bugs group.
    expr: 'sum(count_over_time({service_name="gp-api", deployment_environment_name="$ENV"} | json | context = "QueueConsumerService" | detected_level = "error" | message_Body =~ `"type":"poll.*` [5m]))',
    threshold: 0,
    for: '0m',
    message: [
      'A Serve-related background SQS job has failed in the last 5 minutes.',
      'Click *View in Grafana* to find the failing log lines, then check the associated error message and stack trace to understand what went wrong. Look at the SQS message payload to identify which job failed and whether it can be safely retried.',
    ].join('\n\n'),
    notify: 'serve-bugs',
  },
  // ------ Win Warnings ------ //
  {
    slug: 'win-peerly-warnings',
    name: '[Win] Peerly endpoint errors detected',
    type: 'log',
    expr: [
      'sum(count_over_time(',
      '{service_name="gp-api", deployment_environment_name="$ENV"}',
      // Scope to genuine Peerly vendor API errors only. Keying off
      // request_endpoint matched every error logged during a p2p/tcr/outreach
      // request (LLM, election-api, etc.), not Peerly — 5/5 fires were collateral.
      '|= "Peerly API ERROR"',
      '| json',
      '| detected_level = "error"',
      '| context =~ "Peerly.+Service"',
      '[15m]))',
    ].join(' '),
    threshold: 0,
    for: '1m',
    // Explicitly pins the pre-timeRangeSeconds default. The 600s fetch caps
    // the [15m] vector to an effective 10-minute window; that has always been
    // this alert's firing behavior and is kept as-is — widening it would
    // lengthen re-firing after a transient error burst. Retune deliberately.
    // The message quotes the effective window, not the vector, so nobody
    // triaging this searches a span the query never covered.
    timeRangeSeconds: 600,
    message: [
      'Peerly-related endpoint errors detected in the last 10 minutes.',
      'Dashboard: https://goodparty.grafana.net/d/peerly-prod/peerly-e28094-prod',
    ].join('\n\n'),
    notify: 'win-bugs',
  },
  {
    slug: 'win-outreach-paid-not-scheduled-warning',
    name: '[Win] P2P outreach paid but not scheduled',
    type: 'log',
    // Draft-first outreach: the campaign is persisted as a pending_payment
    // draft before checkout and finalized (Peerly + Slack) by the post-purchase
    // handler after payment. This fires when that finalize fails AFTER money
    // was taken — the row reverts to pending_payment and Stripe's webhook
    // retries. Successor to the campaign 318735 incident alert (2026-07-01),
    // which keyed off webhook-path free-texts redemption; that signal is
    // healthy behavior under draft-first (async payments and recovered
    // client drops finalize via webhook by design).
    expr: [
      'sum(count_over_time(',
      '{service_name="gp-api", deployment_environment_name="$ENV"}',
      '|= "P2P outreach finalize failed after payment"',
      '[1h]))',
    ].join(' '),
    threshold: 0,
    for: '5m',
    // The [1h] range vector needs a matching fetch window; the default 600s
    // would let the engine see only 10 minutes of logs and miss this
    // low-frequency event.
    timeRangeSeconds: 3600,
    message: [
      'A paid P2P outreach draft failed to submit to Peerly in the last hour. Money was taken; the draft reverted to pending_payment and the Stripe webhook will retry automatically.',
      'Click *View in Grafana* to find the log line (search "P2P outreach finalize failed after payment") for the outreachId/campaignId and the underlying Peerly error. A CAS failure Slack message fires alongside this alert.',
      'If it keeps firing for the same outreach, retries are not self-healing — the draft row holds everything needed for manual submission (script, image URL, phone list, identity).',
    ].join('\n\n'),
    notify: 'win-bugs',
  },
  {
    slug: 'win-robocall-critical',
    name: '[Win] Robocall send/settlement CRITICAL',
    type: 'log',
    // The robocall send + settlement chain (staging, dial, capture,
    // fresh-charge, completion poll, hold recovery) logs `CRITICAL robocall ...`
    // on every exceptional path a human must look at: a permanently-failed send
    // (`send_failed`, hold voided), a delivered run we could NOT capture
    // (`uncollectable` — money may be owed), a CallHub response-schema mismatch
    // stranding a delivered run, a dial commit-miss (the campaign may be dialing
    // with no `dialed` record), an audio ETag mismatch refused at staging, or an
    // orphaned-hold cancel. Every one shares the `CRITICAL robocall` prefix, so a
    // single line filter catches every path. They should almost never fire; each
    // is a money- or delivery-integrity event, not routine error noise.
    expr: [
      'sum(count_over_time(',
      '{service_name="gp-api", deployment_environment_name="$ENV"}',
      '|= "CRITICAL robocall"',
      '[1h]))',
    ].join(' '),
    threshold: 0,
    for: '5m',
    // A rare event matched on a [1h] range vector; the default 600s fetch would
    // see only 10 minutes and miss it (same reason as the paid-not-scheduled
    // alert above).
    timeRangeSeconds: 3600,
    message: [
      'A robocall send/settlement CRITICAL was logged in the last hour — a money- or delivery-integrity event that needs a human.',
      'Click *View in Grafana* and search "CRITICAL robocall" for the log line: it names the outreachId and the exact failure (send_failed / uncollectable capture / schema mismatch / dial commit-miss / ETag mismatch / orphaned-hold). The uncollectable and commit-miss cases are the money-sensitive ones — a delivered run we could not capture, or a campaign that may be dialing with no record.',
      'These are not self-healing beyond the automatic sweeps; check the settleState and the Stripe hold/charge for the named outreachId before assuming recovery.',
    ].join('\n\n'),
    notify: 'win-bugs',
  },
  {
    slug: 'door-knocking-route-planner-spend-ceiling',
    name: '[Win] Door-knocking route planner spend ceiling',
    type: 'log',
    // No per-organization spend cap exists — a 500-waypoint daily budget used
    // to sit beside this and was removed — and nothing sums across
    // organizations, so the total bill scales with how many orgs hold the
    // flag. This is that missing global view: a ceiling that pages rather than
    // a hard cap, because one org's spend must not be able to fail another
    // org's knock.
    //
    // Reads the DoorKnockingSpend log line rather than
    // geoapify_credits_total: the log is exact and immune to the
    // counter resets a deploy causes, and it's the same source as the per-org
    // spend queries in docs/door-knocking.md.
    //
    // 6h, not the quota's 24h, and matching the widest window any existing log
    // alert here evaluates. The runaway this is built to catch — a loop, a
    // wider flag rollout than intended — burns fast, and a [24h] vector
    // re-scanned every minute is four times the read for a slower signal, on
    // an alert whose execErrState is Alerting (a query timeout pages).
    expr: [
      'sum(sum_over_time(',
      '{service_name="gp-api", deployment_environment_name="$ENV"}',
      // Cheap line filter before | json, as the sibling log alerts do.
      '|= "DoorKnockingSpend"',
      '| json',
      '| event = "DoorKnockingSpend"',
      '| unwrap credits',
      '[6h]))',
    ].join(' '),
    // Roughly 900 stops routed inside six hours — about six maximum-size
    // turfs, and close enough to two organizations' entire default daily
    // allowance to serve as one. A stop costs a little over ten credits all
    // in, so the two allowances are nearer 11,000; the round number stays
    // because moving a fast-burn threshold on arithmetic alone buys nothing,
    // and the direction it errs in is early. No legitimate pilot morning
    // reaches that; a loop or an unintended rollout does, and it still leaves
    // most of Geoapify's ~50k daily pool to react in.
    threshold: 10000,
    for: '5m',
    // The [6h] range vector needs a matching fetch window; the default 600s
    // would let the engine see only 10 minutes and never accumulate the sum.
    timeRangeSeconds: 21600,
    // Reading 6h on the 60s default re-read the same six hours 1,440 times a
    // day, which made this one of the two most expensive rules we run. A
    // ceiling measured over 6h does not need minute resolution: at 5m the
    // worst case is that a runaway is caught ~4 minutes later, against a
    // Geoapify daily pool this threshold leaves most of intact anyway.
    evaluationIntervalSeconds: 300,
    message: [
      'Door-knocking has burned more than 10,000 Geoapify credits in the last 6 hours — roughly two organizations\u2019 entire daily allowance, and well above any legitimate pilot rate.',
      'Click *View in Grafana* to see the DoorKnockingSpend lines, then group by organizationSlug (`sum by (organizationSlug) (sum_over_time(... | unwrap credits [24h]))`) to find which organizations are driving it. Queries and the per-org breakdown are in gp-api docs/door-knocking.md § Spend visibility.',
      'If the spend is legitimate growth, raise the threshold deliberately. If one org is looping, pull its flag — there is no global cap in the code, so this alert is the only thing standing between a runaway and the Geoapify bill.',
    ].join('\n\n'),
    notify: 'win-bugs',
  },
  // The budget half of the same question, at 60/80/90/95% of the account's
  // daily allowance over 24h. The ceiling above measures RATE and fires first
  // on a runaway; these measure how much of the pool is left, which is what
  // decides whether the next knock gets a route at all. Generated rather than
  // written out four times so the four share one expression — see the file for
  // why that matters to the read cost.
  ...geoapifyBudgetAlerts,
  {
    slug: 'door-knocking-pack-build-failed',
    name: '[Win] Door-knocking pack build failed mid-response',
    type: 'log',
    // GET /v1/door-knocking/pack commits a 200 and starts writing before it
    // begins building, so the connection is never idle long enough for the
    // gateway to kill it. The cost of that trade is that a build which fails
    // AFTER the first byte can no longer be an HTTP error — the route alert
    // sees a 200 and the browser sees a truncated stream. This is the only
    // signal for it.
    //
    // Not folded into the route alert: that one keys on response_statusCode,
    // and by construction this failure has a successful one.
    expr: [
      'sum(count_over_time(',
      '{service_name="gp-api", deployment_environment_name="$ENV"}',
      // Cheap line filter before | json, as the sibling log alerts do.
      '|= "DoorKnockingPackBuildFailed"',
      '| json',
      '| event = "DoorKnockingPackBuildFailed"',
      '[10m]))',
    ].join(' '),
    threshold: 0,
    for: '1m',
    message: [
      'A door-knocking voter-map build failed after gp-api had already started the response, in the last 10 minutes.',
      'The candidate saw the map fail to load. Because the response was already committed as a 200, the per-route error alert cannot see this — the log line is the only signal.',
      'Click *View in Grafana* to find the line (search "DoorKnockingPackBuildFailed") for the organizationSlug, districtId, elapsedMs and the underlying error. A `Code: 57014` there is the 25s people-db statement timeout on one of the pack\'s batches, and `districtId` is the district whose scan did not fit; anything else is an unhandled build failure. A missing `districtId` means the eligibility resolve failed before any scan started.',
    ].join('\n\n'),
    notify: 'win-bugs',
    // The statement timeout is the case this whole registry was built for: the
    // Slack message for it is identical to the message for an unhandled build
    // failure, because the rule counts the event and cannot see the error
    // inside it. Telling them apart has always meant opening Grafana and
    // reading one field, which is exactly the work the filter can do first.
    knownCauses: [
      {
        id: 'people-db-statement-timeout',
        summary:
          "A district large enough that one of the pack's people-db batches exceeds the 25s statement timeout. The query plan does not scale to districts this size yet, so it is a known capacity limit rather than a regression, and it recurs for the same district until that district is reassigned or the plan is changed.",
        // Narrow: the same line filter the alert uses, plus the JSON parse, so
        // this reads the handful of event lines rather than the window.
        evidence: [
          '{service_name="gp-api", deployment_environment_name="$ENV"}',
          '|= "DoorKnockingPackBuildFailed"',
          '| json',
          '| event = "DoorKnockingPackBuildFailed"',
        ].join(' '),
        confirmedBy:
          'Every matched line carries `Code: 57014` in its error, names a `districtId`, and has `elapsedMs` at or above 25000. A single line missing any of the three means something other than a timed-out scan is mixed in, and the alert is not this cause. Report the districtId values so the thread names which districts are over the limit.',
        action: 'suppress',
      },
    ],
  },
  // ------ People (public profiles) ------ //
  {
    slug: 'people-profile-revalidation-failing',
    name: '[People] Public profile cache revalidation failing',
    type: 'metric',
    // person_profile.revalidation.count{result="failed"} — the outbound cache
    // bust to gp-marketing. Sustained failures mean publish/unpublish/delete
    // edits are live in gp-api but the public /people page stays stale until its
    // ISR window (1h) expires.
    expr: 'sum(rate(person_profile_revalidation_count_total{service_name="gp-api", deployment_environment_name="$ENV", result="failed"}[5m]))',
    threshold: 0,
    for: '10m',
    message: [
      'gp-api has been failing to revalidate public /people profile pages for 10 minutes.',
      'Owner edits (publish/unpublish/delete) are persisted but the cached marketing page will not refresh until its ISR window expires. Click *View in Grafana* (People Profiles dashboard), then check that MARKETING_REVALIDATE_SECRET matches gp-marketing and that POST $WEBAPP/api/revalidate-person is reachable and returns 200.',
    ].join('\n\n'),
  },
  {
    slug: 'people-completion-request-event-failing',
    name: '[People] Profile completion nudge events failing',
    type: 'metric',
    // person_profile.completion_request_event.count{result="failed"} — the
    // Segment event a HubSpot workflow sends the "complete your profile" email
    // off. A lost event is a lost email, and nothing retries it: the emit is a
    // detached side-effect of a claim request that has already been committed
    // and answered, so the visitor's ask survives while the nudge silently does
    // not. Volume here is low enough that any sustained failure is worth a look
    // rather than needing a ratio.
    expr: 'sum(rate(person_profile_completion_request_event_count_total{service_name="gp-api", deployment_environment_name="$ENV", result="failed"}[5m]))',
    threshold: 0,
    for: '15m',
    message: [
      'gp-api has been failing to emit profile completion-request events for 15 minutes.',
      'Visitors are successfully asking unclaimed people to complete their profiles, but the Segment event that triggers the nudge email is not landing, and nothing retries it. Those asks are stored in `profile_claim_request` and can be replayed once the cause is fixed.',
      'Click *View in Grafana* to see the failures, then check the log line "Profile completion request event failed" for the underlying error — a Segment outage or a bad SEGMENT_WRITE_KEY are the two shapes to expect. `result="no_email"` on the same metric is NOT a failure and does not fire this.',
    ].join('\n\n'),
  },
  {
    slug: 'people-claim-request-crm-sync-failing',
    name: '[People] Candidate profile request counter not syncing',
    type: 'metric',
    // person_profile.claim_request_crm_sync.count{result="failed"} — the
    // `candidate_profile_requests` write on the subject's HubSpot contact.
    //
    // THERE WAS NO RULE ON THIS METRIC AT ALL until now, which is how it sat at
    // a 100% failure rate in prod while the only people alert that did fire
    // fired about a downstream symptom and named the wrong cause. Both halves
    // of the claim-request CRM side-effect are independent, and this is the
    // half nothing was watching.
    //
    // `no_contact` and `unresolved` are ordinary skips (the CRM has never heard
    // of most of the civics spine, and the warehouse is unconfigured off-prod),
    // so only `failed` is a fault. Volume is low enough that a sustained
    // failure is worth a look without needing a ratio.
    expr: 'sum(rate(person_profile_claim_request_crm_sync_count_total{service_name="gp-api", deployment_environment_name="$ENV", result="failed"}[5m]))',
    threshold: 0,
    for: '15m',
    message: [
      "gp-api has been failing to write `candidate_profile_requests` to candidates' HubSpot contacts for 15 minutes.",
      "Visitors' asks are still being stored in `person_profile_claim_request` and the public endpoint is unaffected — this is a detached side-effect. But the counter marketing segments on is drifting, and because the same lookup establishes whether HubSpot holds a contact for the subject at all, nothing downstream can tell an absent contact from an unread one while this is failing.",
      'Click *View in Grafana*, then check the log line "candidate_profile_requests sync failed (non-fatal)" for the underlying error. The counter is a computed total rather than an increment, so it self-heals on the next submission once the cause is fixed — no replay is needed.',
    ].join('\n\n'),
    knownCauses: [
      {
        id: 'databricks-invalid-client',
        summary:
          "The shared Serve Databricks service principal is being rejected, so the person-mart read that resolves the subject's HubSpot contact id never runs.",
        evidence: [
          '{service_name="gp-api", deployment_environment_name="$ENV"}',
          '|= "candidate_profile_requests sync failed"',
          '|= "invalid_client"',
        ].join(' '),
        confirmedBy:
          'Every matched line carries `invalid_client (Client authentication failed)` and names `DatabricksOAuthManager.getTokenM2M` in its stack. A matched line missing either is a different sync failure and this is not the cause. What this confirms is narrow but useful: the token endpoint rejected the DATABRICKS_CLIENT_ID / DATABRICKS_CLIENT_SECRET pair from the GP_API_PROD secret, which is authentication and happens before any warehouse or table grant is consulted — so a permission change cannot be the cause and a deploy cannot be the fix. It does NOT say which of expired, replaced, mistyped, or never-valid-for-this-workspace applies; check the service principal in Databricks against the client id actually in the secret before assuming a rotation is what is needed.',
        action: 'annotate',
      },
    ],
  },
  {
    slug: 'people-person-contact-email-lookup-failing',
    name: '[People] Person contact email lookup failing',
    type: 'log',
    // REPLACES `people-completion-request-no-email-ratio`, which was deleted
    // rather than retuned because both halves of it were unsound:
    //
    //  - It alerted on a share that is ~100% in the steady state. The `sent`
    //    counter has never once been non-zero in prod, so "over 95% of nudges
    //    undeliverable" is this feature's normal condition, not a regression.
    //    A rule that is always true the moment it has volume gets muted.
    //  - Its `> 20` volume floor never was one. It summed increase() over a
    //    counter whose series conflated both prod tasks, so 4 real submissions
    //    read as 1,702 and the floor was cleared by arithmetic rather than by
    //    traffic — which is how it fired in the first place. See the
    //    service.instance.id comment in src/otel.ts.
    //
    // What that rule was reaching for, and could not see, is the lookup
    // ERRORING: resolveContactEmail returns null both for "no address on file"
    // (ordinary, and most of the spine) and for a 404, and logs this line only
    // for a genuine fault — M2M auth, a 5xx, or election-api unreachable. That
    // is the actionable signal. Address coverage is a data question and belongs
    // on the dashboard, not in #dev-alerts.
    expr: [
      'count_over_time({service_name="gp-api", deployment_environment_name="$ENV"}',
      '|= "Person contact email lookup failed" [5m])',
    ].join(' '),
    threshold: 0,
    for: '15m',
    message: [
      "gp-api has been unable to read subjects' contact addresses from election-api for 15 minutes.",
      "Every profile-completion nudge in this window was skipped for want of an address, which is indistinguishable from ordinary thin coverage in the metric — this log line is the only thing that separates the two. Visitors' asks are unaffected and remain stored in `person_profile_claim_request`.",
      'Click *View in Grafana*, then read the `status` and `reason` fields on the matched lines. A 401/403 is the gp-api → election-api M2M credential; a 5xx or a connection error is election-api itself. Note the response body is deliberately not logged, because on this route the body IS the address.',
    ].join('\n\n'),
  },
  {
    slug: 'public-campaigns-lookup-error-ratio',
    name: '[People] Public campaign lookup failing',
    type: 'log',
    // Written when `public-campaigns` was not in ALERT_OWNERSHIP and its
    // generated per-route alert was therefore provisioned `disabled` — which
    // is why 5k+ daily 500s on a public endpoint paged nobody. It was left out
    // of the ownership map on the grounds that the generated rule fires on a
    // single error in the window, so on a route serving ~2 req/s it would fire
    // continuously and be muted.
    //
    // It is in the map as of 2026-09, because that stopped being true: in the
    // seven days to 09-17 this route produced ZERO errors the generated rule
    // would fire on, and the 5k-a-day era it was reasoning from is over. The
    // two rules now stack rather than substitute — the generated one answers
    // "did anything fail at all" within a minute, this one answers "is the
    // route substantially broken" and carries the known causes below.
    //
    // Keep this rule anyway. It is the one that still works if the volume
    // returns, and the argument above becomes true again the moment it does.
    //
    // Denominator is lookups that resolved to a campaign (non-404), not all
    // traffic. ~95% of requests are 404s — gp-marketing asks "has this
    // candidate claimed their profile?" once per candidate page render, across
    // a candidate universe far larger than the claimed one, so a miss is the
    // feature working. Including them diluted the signal to 0.8-4% over 24h,
    // too close to a plausible threshold to place one safely; against non-404s
    // the same period reads 21-100%, nowhere near the 10% below.
    //
    // The `and` clause is a volume floor: below 20 resolvable lookups in the
    // window a ratio is noise, and one stray 500 would page. Under the floor
    // the query returns no data, which grafana.ts maps to OK (noDataState),
    // not Alerting. The cost is that a large drop in traffic (e.g. if
    // gp-marketing starts caching this call) silences the alert.
    //
    // KNOWN GAP, written down rather than left to be rediscovered: unlike the
    // generated rules and unlike public-person-profiles-error-ratio below,
    // this one does not admit `response_statusCode = ""`, so a request the
    // gateway kills mid-flight is invisible to it — see noStatusFilter in
    // controller-alerts.ts for why that is the one failure a status range
    // cannot see. A pure timeout wave on this route would score 0% and page
    // nobody. Closing it is a one-line change on each half, but it moves the
    // firing profile of a live rule, and the numbers quoted above were
    // measured against the narrow expression; it wants its own replay over
    // real traffic rather than being changed in passing here.
    expr: [
      '( sum(count_over_time(',
      '{service_name="gp-api", deployment_environment_name="$ENV"}',
      // Cheap line filter before | json, as the sibling log alerts do.
      '|= "Request completed" | json',
      '| request_endpoint = "GET /v1/public-campaigns"',
      '| response_statusCode >= 500',
      '[10m]))',
      '/',
      'sum(count_over_time(',
      '{service_name="gp-api", deployment_environment_name="$ENV"}',
      '|= "Request completed" | json',
      '| request_endpoint = "GET /v1/public-campaigns"',
      '| response_statusCode != 404',
      '[10m])) )',
      'and',
      '( sum(count_over_time(',
      '{service_name="gp-api", deployment_environment_name="$ENV"}',
      '|= "Request completed" | json',
      '| request_endpoint = "GET /v1/public-campaigns"',
      '| response_statusCode != 404',
      '[10m])) > 20 )',
    ].join(' '),
    threshold: 0.1,
    for: '10m',
    message: [
      'More than 10% of the campaign lookups that resolved to a claimed candidate returned a server error in the last 10 minutes.',
      'This endpoint backs the public candidate profiles on the marketing site: while it fails, claimed candidates render as unclaimed. 404s are excluded — most requests legitimately miss, because the caller asks about every candidate, not only claimed ones.',
      'Click *View in Grafana* to find the failing requests. Response validation failures are the known shape of this: search context="ZodResponseInterceptor", whose log names the schema path that rejected the response.',
    ].join('\n\n'),
    knownCauses: [
      {
        id: 'zod-response-validation',
        summary:
          'The response failed its own schema validation rather than the handler failing. The 500 is ZodResponseInterceptor rejecting a shape, so the named schema path is the fix site.',
        // DELIBERATELY NOT SCOPED TO THE ENDPOINT, though `request_endpoint`
        // rides on every request-scoped line (app.ts sets `req.route` before
        // pino-http, for exactly this). Filtering it here would make the
        // condition below true of anything the query could return, because the
        // lines that disconfirm the cause — rejections from other routes — are
        // the ones the filter would have removed. The classifier has to be able
        // to see them to reject on them.
        evidence: [
          '{service_name="gp-api", deployment_environment_name="$ENV"}',
          '|= "ZodResponseInterceptor"',
          '| json',
          '| context = "ZodResponseInterceptor"',
        ].join(' '),
        confirmedBy:
          'Every matched line is a rejection on `GET /v1/public-campaigns` — read `request_endpoint` — and names a schema path under `issues`. Matched lines from other routes only means unrelated response-validation noise and is NOT this cause; no matched lines at all means the 500s came from the handler rather than from the response shape, which is also not this cause. Claimed candidates render as unclaimed either way, so confirming this names the cause without making the alert less urgent.',
        action: 'annotate',
      },
    ],
  },
  {
    slug: 'admin-impersonation-email-fallback-spike',
    name: '[Admin] Impersonation falling back to email actor',
    type: 'log',
    expr: 'sum(count_over_time({service_name="gp-api", deployment_environment_name="$ENV"} |= "Actor has no gp-api Clerk account" [15m]))',
    threshold: 5,
    for: '5m',
    // Explicitly pins the pre-timeRangeSeconds default: effectively >5 events
    // per 10 minutes, this alert's firing behavior since it shipped. Kept
    // as-is; raising to 900 would make it more sensitive. Retune deliberately.
    // The message quotes the effective window, not the vector, so nobody
    // triaging this searches a span the query never covered.
    timeRangeSeconds: 600,
    message: [
      'More than 5 admin impersonations have used the email-as-actor.sub fallback in the last 10 minutes.',
      "This means actorEmail lookups against gp-api's Clerk instance returned no match for those impersonation requests. Possible causes:",
      '  • Admins without a gp-api Clerk account are impersonating (a routine baseline may exist; we have not yet measured it)',
      '  • Email casing/format regression in gp-admin → SDK → controller',
      '  • Clerk lookup degraded or rate-limited',
      '  • Clerk has begun rejecting non-user_ actor.sub values',
      'Click *View in Grafana* to see the warn log lines (search "Actor has no gp-api Clerk account") and inspect the affected actorEmail values, then verify whether those admins exist in the gp-api Clerk instance.',
    ].join('\n\n'),
  },
  {
    slug: 'district-auto-match-no-district-spike',
    name: '[Serve] District auto-match: no-district spike',
    type: 'log',
    // Count of DISTINCT campaigns whose gold auto-match resolved a position but
    // found NO associated district in the last 6h. Keying off failureKind
    // isolates the *silent* failure mode (election-api returns a position with
    // no district, or a 404) from failureKind="error" (upstream 5xx), which
    // already pages via the per-route 5xx controller alerts — so this does not
    // double-alert on genuine election-api outages. The distinct-campaign count
    // dedupes a single campaign retrying (the place_id incident logged 30
    // retries from one position). Real no_match volume is ~0 in normal
    // operation, so a spike almost always means the position→district pipeline
    // (dbt mart / district association) broke without erroring.
    expr: [
      'count(sum by (campaignId) (count_over_time(',
      '{service_name="gp-api", deployment_environment_name="$ENV"}',
      // Pin the cheap |= line filter before | json (as the sibling alerts do):
      // it narrows 6h of all gp-api logs down to the handful of DistrictMatch
      // events before the JSON parse, so the every-minute eval stays light and
      // can't time out into a false page (execErrState is Alerting).
      '|= "DistrictMatch"',
      '| json',
      '| event = "DistrictMatch"',
      '| failureKind = "no_match"',
      '[6h])))',
    ].join(' '),
    threshold: 5,
    for: '30m',
    // The [6h] range vector needs a matching fetch window; the default 600s
    // would let the engine see only 10 minutes of logs and never accumulate
    // the 6h count this alert is built on.
    timeRangeSeconds: 21600,
    // As above: 6h of logs re-read every 60s was one of our two costliest
    // rules. `for` is 30m here, so a 5m interval still gives the rule six
    // evaluations before it fires and barely moves detection latency.
    evaluationIntervalSeconds: 300,
    message: [
      'More than 5 distinct campaigns hit a "no matched district" outcome in the last 6h — well above the ~0 baseline.',
      'This usually means the auto-district-matching pipeline broke *silently*: election-api is returning a position with no associated district (or a 404) rather than an error. Likely causes: a district-association / dbt mart regression, or an election-api data/deploy issue that stopped attaching districts. Note that upstream election-api errors (5xx) are excluded here — those page via the per-route error alerts instead.',
      'Click *View in Grafana* to see the failure logs (event="DistrictMatch", failureKind="no_match"), then inspect the affected positionId / ballotreadyPositionId values and confirm whether election-api is still returning districts for them.',
    ].join('\n\n'),
    notify: 'serve-bugs',
    // BOTH ARE `annotate`, NOT `suppress`, and the distinction is the whole
    // reason this alert is worth listing at all. The two shapes below are
    // genuinely understood, but this rule fires on a SPIKE across five or more
    // distinct campaigns — and a spike of a known-benign cause is how a real
    // pipeline regression looks on its way in. So the filter says which shape
    // it found and still shows the alert, which saves the reader the Grafana
    // round-trip without deciding on their behalf that nothing happened.
    knownCauses: [
      {
        id: 'position-resolved-without-district',
        summary:
          'election-api returned a position but attached no district to it, so the match silently found nothing. Usually a district-association or dbt mart gap for that position rather than an outage.',
        evidence: [
          '{service_name="gp-api", deployment_environment_name="$ENV"}',
          '|= "DistrictMatch"',
          '| json',
          '| event = "DistrictMatch"',
          '| failureKind = "no_match"',
        ].join(' '),
        confirmedBy:
          'The matched lines name positionId / ballotreadyPositionId values and carry no upstream error. A concentration on a handful of positions points at those positions; a spread across many unrelated ones points at the pipeline and is NOT this cause.',
        action: 'annotate',
      },
      {
        id: 'upstream-position-lookup-404',
        summary:
          'election-api answered 404 for the position, so there was nothing to match against. Distinct from a 5xx, which pages through the per-route controller alerts instead.',
        evidence: [
          '{service_name="gp-api", deployment_environment_name="$ENV"}',
          '|= "DistrictMatch"',
          '| json',
          '| event = "DistrictMatch"',
        ].join(' '),
        confirmedBy:
          'The matched lines report a 404 status from the election-api lookup. Any 5xx in the same window means this is an upstream outage instead, which is a different alert and a different response.',
        action: 'annotate',
      },
    ],
  },
  // ------ The alert about the alerting ------ //
  //
  // LAST IN THE ARRAY ON PURPOSE, despite being the one rule here that guards
  // all the others and belonging at the top on any reading of importance.
  //
  // Grafana rule groups are provisioned as a POSITIONAL list, so a rule
  // inserted at the front renames every rule after it. The first draft of this
  // put it first and the infra diff came back as twelve rewritten rules —
  // high-cpu becoming this one, high-memory becoming high-cpu, and so on down —
  // which is unreviewable, and which asks Grafana to update twelve live rules
  // to add one. Appended, the same change is a single addition.
  //
  // Add new alerts at the end for the same reason.
  {
    slug: 'alert-notification-delivery-failing',
    name: 'Alert notifications are failing to deliver',
    type: 'metric',
    // Grafana Cloud's own alerting metric, so this measures the delivery
    // attempt rather than anything gp-api can see. That is the point: every
    // other rule in this file is invisible if delivery is what broke.
    expr: 'sum(increase(grafanacloud_instance_alerting_notification_send_failures_total[10m]))',
    threshold: 0,
    for: '5m',
    message: [
      'Grafana failed to deliver alert notifications in the last 10 minutes. **Alerts are firing and not arriving.**',
      'The likely cause is the `gpbot-alert-filter` contact point: the filter Lambda is a single point of failure for everything routed through it, so a Lambda that is erroring or timing out stops notifications rather than merely delaying them. Check `/aws/lambda/alert-filter-prod` in CloudWatch, then Grafana Alerting → Contact points → the delivery error on `gpbot-alert-filter`.',
      'To restore alerting immediately, repoint the affected notification policy back at the plain Slack contact point. Alerts resume unfiltered, which is the state this whole feature started from and is always safe to return to.',
    ].join('\n\n'),
    // NO `notify`, and that is deliberate rather than an omission. A subteam
    // mention is added to the message body, and this rule's whole premise is
    // that the path carrying message bodies is broken — so the mention would
    // travel exactly as far as the thing it is meant to escape. What makes this
    // alert work is its ROUTE: the notification policy must send this slug to a
    // contact point that does not pass through the filter. That cannot be
    // expressed here, because the policy tree is not provisioned by this repo;
    // it is the second half of the ops step in gp-ai/alert_filter/README.md.
    //
    // A rule that pages nobody looks like a mistake, so: this one is a
    // deliberate no-mention rule, and if it fires unrouted it still appears in
    // Grafana's own alert list, which is the last channel left when every other
    // one depends on the thing that broke.
  },
  {
    slug: 'public-person-profiles-error-ratio',
    name: '[People] Public person profile requests failing',
    type: 'log',
    // The rule that was missing on 2026-08-24, when GET /v1/public-person
    // -profiles/voter-density began answering every single request with a 500
    // and continued for four days. 1,498,324 of them. Nothing fired, because
    // `public-person-profiles` is in CONTROLLERS_WITHOUT_ROUTE_ALERTS, so its
    // generated rule is provisioned disabled. It ended when the table it reads
    // was created, not when anyone responded.
    //
    // Same shape as public-campaigns-lookup-error-ratio above. This controller
    // is ALSO in ALERT_OWNERSHIP, so it has a generated route alert too, and
    // the two are not redundant: the generated rule trips on the first error
    // and this one only when a route is substantially broken, so the pair
    // separates "something failed" from "this route is down" without either
    // having to guess which it is.
    //
    // The case for not opting the controller in — that a threshold-0 rule on a
    // route serving ~4 req/s would fire permanently and get muted — was worth
    // testing rather than assuming, and did not hold. Over the seven days to
    // 2026-09-17 the errors the generated rule fires on fell in 2 hours out of
    // 168: a 52-error burst and one stray. So it pages about twice a week at
    // worst, and the muting risk was theoretical.
    //
    // `sum by (request_endpoint)` rather than one ratio for the controller:
    // Grafana turns each returned series into its own alert instance, so a
    // route that is entirely broken is judged on its own numbers instead of
    // being averaged out by a busier sibling that is fine. In August the base
    // route was healthy and served more traffic than the one that was down.
    //
    // Prefix regex rather than the exact alternation the generated rules build,
    // so a route added to this controller is covered the day it ships. That is
    // the whole complaint this alert answers, and an alternation would have to
    // be remembered.
    //
    // Denominator excludes 404s for the reason it does on public-campaigns:
    // most requests here legitimately miss (1.8M of them in the last 7 days).
    // gp-marketing asks about every candidate, and a person who maps to no L2
    // district gets no heat map — both are the feature working, and counting
    // them buries a total outage in a rounding error. Against non-404s the
    // August failure reads 100%, and normal weeks read under 0.01%.
    //
    // The volume floor is the same 20-in-the-window guard, per route: under it
    // the series drops out, which grafana.ts maps to OK via noDataState, so a
    // single 500 on a quiet route does not page. It also means a route that
    // stops being called cannot alert — acceptable, since a route with no
    // traffic has no users to fail.
    //
    // WHAT THIS WILL PAGE FOR, measured rather than guessed. Replayed over the
    // 30 days to 2026-09-16 it produces two firings, both real: the August
    // outage, and a connection-pool exhaustion burst on the base route on
    // 09-14 that held 99% for twenty minutes. The second only counts because
    // P2024 now answers 503 instead of 400 (see prisma-exception.filter.ts) —
    // it was invisible to every 5xx rule at the time. Over the quiet week of
    // 09-09 the expression returns a single datapoint, 0.036%, which is 274x
    // under the threshold. So: roughly two pages a month, and nothing to mute.
    //
    // Both halves admit `response_statusCode = ""` for the reason
    // controller-alerts.ts spells out at `noStatusFilter`: a request the
    // gateway kills mid-flight completes with a null status, Loki's json
    // parser drops a null field, and every status-RANGE filter therefore
    // misses it. The generated rules were widened after two door-knocking
    // pack timeouts went unseen that way in August; written the narrow way
    // here, a wave of gateway timeouts on voter-density would be scored 0%
    // and page nobody — the same endpoint, the same silence, one release
    // after this rule was added to end it.
    //
    // It has to be added to the denominator too, not just the numerator. A
    // rule that counted no-status requests as failures but not as traffic
    // would read over 100% during a pure timeout wave, and the volume floor
    // would be measuring a smaller population than the ratio it guards.
    expr: [
      '( sum by (request_endpoint) (count_over_time(',
      '{service_name="gp-api", deployment_environment_name="$ENV"}',
      '|= "Request completed" | json',
      '| request_endpoint =~ `^[A-Z]+ /v1/public-person-profiles(/.*)?$`',
      '| ( response_statusCode >= 500 ) or ( response_statusCode = "" )',
      '[10m]))',
      '/',
      'sum by (request_endpoint) (count_over_time(',
      '{service_name="gp-api", deployment_environment_name="$ENV"}',
      '|= "Request completed" | json',
      '| request_endpoint =~ `^[A-Z]+ /v1/public-person-profiles(/.*)?$`',
      '| ( response_statusCode != 404 ) or ( response_statusCode = "" )',
      '[10m])) )',
      'and',
      '( sum by (request_endpoint) (count_over_time(',
      '{service_name="gp-api", deployment_environment_name="$ENV"}',
      '|= "Request completed" | json',
      '| request_endpoint =~ `^[A-Z]+ /v1/public-person-profiles(/.*)?$`',
      '| ( response_statusCode != 404 ) or ( response_statusCode = "" )',
      '[10m])) > 20 )',
    ].join(' '),
    threshold: 0.1,
    for: '10m',
    summaryDetail: '`{{ $labels.request_endpoint }}`',
    message: [
      'More than 10% of the requests to `{{ $labels.request_endpoint }}` that did not legitimately miss returned a server error, or no status at all, in the last 10 minutes (status ≥ 500 or null).',
      'These routes back the public candidate profiles on the marketing site. 404s are excluded because most requests here are meant to miss: the caller asks about every candidate, and a person who maps to no L2 district has no heat map to return.',
      'Click *View in Grafana* to find the failing requests. Check which Prisma client raised the error before assuming the main database: the voter-density route reads people-db through a second client (see peopleDb/AGENTS.md), and its tables are populated by the data team rather than by a migration in this repo — so a table this repo has a migration for can still be absent in the database.',
      'A **null** status means gp-api never wrote one: the request was killed in flight, usually by the gateway’s ~120s idle timeout. Check `responseTimeMs` on those lines — a cluster at ~120,000ms is the timeout rather than the handler, and points at how long the query takes rather than at what it returned.',
    ].join('\n\n'),
    knownCauses: [
      {
        id: 'people-db-table-missing',
        summary:
          'The people-db table the voter-density route reads does not exist. gp-api has a migration for it, but the data team creates and populates it (dbt/Databricks), so shipping the reader before that lands breaks the route completely until it does.',
        // Not scoped to a status code or endpoint: the P2021 is what confirms
        // the cause, and it is raised before any response is written. Matching
        // only the failing route's completions would hide the case where the
        // same missing table is breaking something else too, which is the
        // evidence that this is a data-side outage rather than one route's bug.
        evidence: [
          '{service_name="gp-api", deployment_environment_name="$ENV"}',
          '|= "does not exist in the current database"',
          '| json',
          '| exception_type = "P2021"',
        ].join(' '),
        confirmedBy:
          "Matched lines name the missing table in `exception.message`, and their `exception.stacktrace` runs through generated/people-prisma. No matched lines means the failures are something else and this is NOT the cause. This does not lower the urgency: while it holds, the route returns nothing to anyone, and the fix is on the data team's side rather than in a deploy of this repo.",
        action: 'annotate',
      },
    ],
  },
]
