import { ControllerName } from '../../src/generated/route-types'
import { Alert, SlackGroup } from './alerting/alerts.types'
import { geoapifyBudgetAlerts } from './alerting/geoapify-budget-alerts'
import { doorKnockingCredits } from './alerting/door-knocking-spend'

/**
 * Which product's users each controller serves, and therefore who hears about
 * it when it breaks.
 *
 * Being in here is what enables a controller's generated route alert at all —
 * `routeAlertGroups` skips a controller with no owner. That has been true
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
  // The staff results surface. Serve, not Win, despite sitting beside the CAS
  // SMS console: the sends it takes results for are elected officials' texts
  // to constituents, and polls joins it later on the same side.
  'outreach/admin/results': [SERVE],
  priorities: [SERVE],
  // Send-from-a-chat-card. Serve because the only thing that mints a proposal
  // key is a priority chat, and a failure here is an elected official pressing
  // Send and getting nothing.
  'outreach/by-proposal-key': [SERVE],
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
  // One route serving both products' tools, so BOTH is the literal answer
  // rather than the safe one. The 13 handlers carrying `@McpTool` today are 9
  // Win surfaces (campaigns, tracker tasks, TCR compliance, websites, domains)
  // and 4 Serve ones (priorities, community issues, ordinance flow), and a
  // `tools/call` is an internal proxy of whichever one the agent picked — see
  // src/mcp/AGENTS.md § Request flow. A failure at the transport is a failure
  // of every tool behind it, so neither team can be the one told second.
  mcp: BOTH,
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
 * `dev-env` is `test-fixtures`' twin: it 404s outside dev, it vends local
 * `.env` values to a contributor setting a laptop up, and a failure there
 * stalls one person's `npm run setup` — they are looking at the error already.
 * There is no product surface behind it to page for.
 *
 * `version` echoes the build version and `queue` is a method literally named
 * `testQueue()` that enqueues a hardcoded `test-slug` — a development poke, not
 * a product route. Nothing downstream depends on either answering.
 *
 * `ecanvasser` is the one entry here that is not a claim about the routes being
 * unimportant — it is a claim about the system being over. It mirrors a
 * third-party canvassing tool into our Postgres for the control arm of the
 * `native-door-knocking` experiment, and 114 of its 137 prod integrations are
 * already failing to sync against expired or revoked per-candidate API keys.
 * Nobody is going to fix those keys: the whole module is deleted the moment the
 * flag reaches 100%. Until then its 5xx are a known, accepted, un-actioned
 * state, and paging win-bugs for them trains the rotation to ignore it.
 * This entry goes away with the module.
 *
 * Every entry is now a claim of that kind, which was not true until 2026-09-17.
 * `mcp` sat here because it had no ROUTE_MAP entries at all — its only handler
 * is `@All()`, which generate-route-types.ts did not recognise — so
 * no group could claim it and there was no rule to enable.
 * Being listed here made it look reviewed while POST /v1/mcp served 24,736 real
 * requests in 30 days and answered 19 of them with nothing. The generator now
 * expands `@All()` and refuses outright to emit a controller with no routes, so
 * a controller can only reach this list by someone deciding it belongs.
 */
export const CONTROLLERS_WITHOUT_ROUTE_ALERTS: ControllerName[] = [
  'health',
  'test-fixtures',
  'dev-env',
  'version',
  'queue',
  'ecanvasser',
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
 * alerting/route-alerts.ts. That is a request gp-api never answered, so
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
 *
 * `campaigns/tcr-compliance` was measured over 30 days of prod logs to
 * 2026-09-27. Its entire counted 4xx vocabulary is one response:
 *
 *    31  422 "Invalid PIN" on POST /:id/submit-cv-pin
 *
 * against 19 successful submissions in the same window — a ~40% standing rate,
 * because it is what the route answers when a candidate mistypes the 6-digit
 * Campaign Verify PIN. It is thrown only after the code has confirmed Peerly's
 * CV status is APPROVED, so a PIN provably existed and the digits provably did
 * not match; a PIN that was never issued answers 409 instead
 * (CampaignVerifyPinNotIssuedException), precisely so the FE can distinguish
 * the two (ENG-10866). There is no fault to report either way.
 *
 * Spread across ~25 separate 10-minute windows, that was paging win-bugs about
 * twice a week for people typing a wrong number. Two of the four users in the
 * 2026-09-25 firing retried and got a 200 minutes later, which is the whole
 * argument: verify_pin accepts a correct PIN, so the integration is healthy and
 * the page carried no action.
 *
 * What this keeps, from the same 30 days: 96 × 502 on POST /submit-to-peerly,
 * 2 × 502 on POST /admin/:campaignId/resend-cv-pin, and 1 × 500 on GET /mine.
 * The 502s are a real Peerly-side failure mode and by far the most valuable
 * signal this controller has, so the entry is only defensible because it leaves
 * them counted.
 *
 * The 422s this drops are not the controller's only designed 422 — the
 * submit-to-peerly stage gate and the resend-PIN preconditions raise one too —
 * and none of them is a fault. The cost is the usual one: a genuine bug here
 * that surfaces as a 4xx now reaches us through the logs rather than a page.
 */
export const SERVER_ERRORS_ONLY: ControllerName[] = [
  'door-knocking',
  'contacts',
  'campaigns/tcr-compliance',
]

/**
 * Controllers whose generated route alert needs a burst rather than a single
 * error, keyed to the count a 10-minute window must EXCEED.
 *
 * AN ENTRY HERE ALSO BUYS THE 10-MINUTE WINDOW, which is not a separate knob:
 * `routeWindow` in alerting/route-alerts.ts derives the window from the
 * threshold, because a threshold is an accumulation and there is nothing to
 * accumulate at 0. Every other group judges a single minute and pages that
 * much sooner. So setting a threshold costs that controller nine minutes of
 * detection latency on top of the errors it stops paging for — both halves of
 * the trade are argued where the window is chosen.
 *
 * The default of 0 pages on one qualifying error, and that is right nearly
 * everywhere: on a controller that errors a handful of times a month, the
 * first error IS the incident and waiting for a second only delays the page.
 *
 * It is wrong for a high-volume public route whose failure mode includes a
 * transient upstream. `GET /v1/public-person-profiles/voter-density` serves
 * ~150k requests a day and resolves the person's district through
 * election-api on every one of them; an isolated 502 there costs one visitor
 * one heat map, on a card that is progressive enhancement to begin with, and
 * the next request succeeds. Paging on it spends attention at a rate the
 * failure does not justify, and the estate has already lost one alert that
 * way — see the `contacts` note in SERVER_ERRORS_ONLY.
 *
 * MEASURED before being set, over the 30 days to 2026-09-18, counting the
 * errors this rule actually fires on per 10-minute window:
 *
 *   - Outside a real incident, EVERY window held 1 or 2 errors. There were 18
 *     of them, spread across the month, each a single transient 502.
 *   - The 2026-08-24 outage opened with 83 in its first window and then ran
 *     2,000-4,800 per window for four days.
 *   - The 2026-09-14 burst was 52 errors split across two windows, 5 then 47.
 *
 * So `> 2` drops all 18 noise windows and keeps both incidents, and it keeps
 * them at the same evaluation they would have fired on before — the nearest
 * real window is 5, comfortably clear, and nothing measured lands on 3 or 4.
 *
 * THE COST, stated plainly: a fault that produces one or two errors per 10
 * minutes and never more will no longer page here. On this route that is a
 * fault affecting under 0.01% of requests, which is below what the ratio rule
 * would call broken anyway, and it still lands in the logs and on the
 * dashboard. A fault that grows past it pages on the window it grows in.
 *
 * This does not touch `public-person-profiles-error-ratio`, which asks the
 * other question — whether the route is substantially broken — and is
 * unchanged. The pair still separates "something failed" from "this is down";
 * this only moves where the first of those starts counting.
 */
export const ROUTE_ERROR_THRESHOLDS: Partial<Record<ControllerName, number>> = {
  'public-person-profiles': 2,
}

/**
 * Log-query spend as a fraction of what the plan includes.
 *
 * The allowance is 100x ingest, so this is `bytes read / (100 * bytes
 * written)` — one expression shared by the 50% and 80% rules, because two
 * thresholds on one measurement should not be able to drift into measuring
 * two different things.
 *
 * Both sides are 6h-averaged. `:rate5m` on either alone is spiky enough that
 * one wide ad-hoc query would clear 50% on its own, and a budget alert that
 * fires on a single query is a budget alert nobody keeps. An hour turned out
 * not to be enough of that smoothing — see the window note on the 50% rule.
 */
const LOKI_QUERY_BUDGET_RATIO = [
  'sum(avg_over_time(grafanacloud_logs_instance_query_bytes:rate5m[6h]))',
  '/',
  '(100 * sum(avg_over_time(grafanacloud_logs_instance_billable_bytes_received_per_second[6h])))',
].join(' ')

/**
 * How to find out which query is spending the budget.
 *
 * Attribution is per-rule and it is obtainable, which is the difference
 * between a useful budget alert and a puzzle — so the query goes in the
 * notification rather than in a doc the reader has to know exists.
 * `grafanacloud-usage-insights` is Grafana's own usage stream and does not
 * bill against the allowance it reports on, so running this while over budget
 * is safe.
 */
const LOKI_ATTRIBUTION_PROSE = [
  'Find the offender in Explore on the `grafanacloud-usage-insights` datasource — it reports bytes scanned per rule and does not bill against the allowance it measures:',
  '```',
  'topk(10, sum by (rule_name) (sum_over_time(',
  '  {instance_type="logs"} | logfmt | __error__="" | source="grafana-alert"',
  '  | unwrap total_bytes [24h]',
  ')))',
  '```',
  'Drop the `source="grafana-alert"` matcher to see ad-hoc queries alongside the rules.',
].join('\n')

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
    slug: 'win-cv-status-reads-failing',
    name: '[Win] Campaign Verify status reads failing',
    type: 'log',
    // The scheduled Campaign Verify status reads, counted where the sweep
    // records its own failures rather than where the vendor error is logged.
    // Both the twice-daily scan and the 30-minute fresh poll write this line
    // once per record they cannot read, so one literal covers both prefixes.
    //
    // WHY IT IS NOT `win-peerly-warnings` DOING THIS. That rule counts
    // error-level vendor lines with a threshold of zero, which is right for a
    // read a person is waiting on and wrong for a swept one: on 2026-09-30
    // Campaign Verify began answering 403 to every status read, and the poll
    // paged every thirty minutes for the single registration it was polling,
    // with nothing in the message naming it. The same failure during a full
    // scan is 60+ pages. The swept read now logs at `warn`
    // (`handledByCaller` on the Peerly error context), and persistence is what
    // this rule measures instead.
    //
    // The threshold is what makes it mean "still failing". The fresh poll reads
    // twice an hour, so one failure is a blip the next pass corrects and two is
    // a registration whose status we have been unable to read for half an hour;
    // a broad vendor failure clears it immediately, from several records at
    // once. A record only the twice-daily scan touches cannot reach 2 in an
    // hour by itself and is covered by the nightly 10DLC report's stalled-
    // registration sections instead.
    expr: [
      'sum(count_over_time(',
      '{service_name="gp-api", deployment_environment_name="$ENV"}',
      '|= "CV poll failed for record"',
      '[1h]))',
    ].join(' '),
    threshold: 1,
    for: '0m',
    // The [1h] vector needs a matching fetch window, and an hour re-read every
    // minute would be 60x ingest on its own. At 30 minutes it is 2x, and `for`
    // is zero so the rule still fires on the first evaluation past the
    // threshold — within half an hour of the second failed read.
    timeRangeSeconds: 3600,
    evaluationIntervalSeconds: 1800,
    message: [
      "Two or more scheduled reads of a candidate's Campaign Verify status have failed in the last hour, so at least one 10DLC registration cannot progress: no PIN-sent notice, no rejection detection, and the PIN screen falls back to the last status we managed to observe.",
      'Click *View in Grafana* and read the matching `CV poll failed for record` lines: each carries the `tcrComplianceId` and the Peerly response. A body of `{"Error":"Campaign Verify ... request failed.","status_code":403}` is Campaign Verify refusing us rather than anything gp-api did, and needs raising with Peerly.',
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
    // An hour of logs on the 60s default re-read the same hour 1,440 times a
    // day — 60x our ingest for one rule, against a query allowance of 100x that
    // every rule and both environments share. At 5m it is 12x. `for` is 5m, so
    // the rule still fires on its first evaluation past the threshold and the
    // worst case is ~5 minutes later than before, on an event whose remedy is
    // a human reading a log line.
    evaluationIntervalSeconds: 300,
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
    // 12x ingest rather than 60x, for the reason given on the sibling above.
    // These events are money-integrity ones that need a human, not a rollback,
    // so ~5 minutes of extra detection latency costs nothing real.
    evaluationIntervalSeconds: 300,
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
    type: 'metric',
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
    // spend queries in docs/door-knocking.md. It reaches that line through the
    // recorded metric rather than by scanning Loki itself — same measurement,
    // one read a minute shared with the four budget tiers instead of a 6h
    // window re-scanned every 5 minutes. See alerting/door-knocking-spend.ts.
    //
    // 6h, not the quota's 24h. The runaway this is built to catch — a loop, a
    // wider flag rollout than intended — burns fast, and the tiers are what
    // watch the pool. Assembling the window in PromQL costs nothing, so the
    // choice is now purely about what signal is wanted.
    expr: doorKnockingCredits('6h'),
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
    // Reading 6h of logs on the 60s default re-read the same six hours 1,440
    // times a day, which made this one of the two most expensive rules we ran.
    // Now that the 6h window is assembled from a recorded metric the read is
    // free, and 5m stays only because the firing behaviour was tuned under it.
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
      'Click *View in Grafana* to find the line (search "DoorKnockingPackBuildFailed") for the organizationSlug, districtId, elapsedMs and the underlying error. A `Databricks statement exceeded` there is the 60s statement timeout on one of the pack\'s batches, and `districtId` is the district whose scan did not fit; anything else is an unhandled build failure. A missing `districtId` means the eligibility resolve failed before any scan started.',
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
          "A district large enough that one of the pack's batches exceeds the 60s Databricks statement timeout. The query plan does not scale to districts this size yet, so it is a known capacity limit rather than a regression, and it recurs for the same district until that district is reassigned or the plan is changed.",
        // Narrow: the same line filter the alert uses, plus the JSON parse, so
        // this reads the handful of event lines rather than the window.
        evidence: [
          '{service_name="gp-api", deployment_environment_name="$ENV"}',
          '|= "DoorKnockingPackBuildFailed"',
          '| json',
          '| event = "DoorKnockingPackBuildFailed"',
        ].join(' '),
        confirmedBy:
          'Every matched line carries `Databricks statement exceeded` in its error, names a `districtId`, and has `elapsedMs` at or above 60000. A single line missing any of the three means something other than a timed-out scan is mixed in, and the alert is not this cause. Report the districtId values so the thread names which districts are over the limit.',
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
    //    traffic — which is how it fired in the first place. `service
    //    .instance.id` on the metric resource fixed the conflation (see
    //    src/otel.ts); it did not make the rule worth reinstating.
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
    slug: 'people-person-id-repoint-collision',
    name: '[People] Person id repoint blocked, left for manual resolution',
    type: 'log',
    // The one drift outcome that ASKS FOR A HUMAN BY NAME and, until this
    // rule, told none. `resyncLinkedUser` ends in exactly five ways; four are
    // self-correcting (`repointed` fixed it, `unchanged` had nothing to fix,
    // `unresolved` retries tomorrow, `failed` is a transient the next sweep
    // re-attempts). `collision` is the one that does not: the destination
    // civics id already holds another user's rows, so the repoint is abandoned
    // and the stale link stays stale every night until somebody merges the two
    // by hand.
    //
    // Nothing about that is visible from outside. gp-api answers a correct 404
    // at the abandoned id and a correct 200 at the destination, both services
    // report healthy, and the only symptom is a public profile that renders
    // the unclaimed civics spine instead of its owner — or, worse, a takedown
    // that stops being honored because `isRemoved` matches on an id the person
    // no longer renders under. See the header on `resyncLinkedUser`.
    //
    // ON THE LOG RATHER THAN person_profile_person_id_drift_count_total. The
    // log line is exact, it survives the counter reset every deploy causes,
    // and it carries the `userId`, `from`, `to` and `blocker` the responder
    // needs, which the counter's `result` label does not.
    //
    // Both collision branches: the pre-check in `repoint` and the unique
    // violation that loses a race to a concurrent write. Same situation, found
    // at different moments, same manual fix.
    expr: [
      'sum(count_over_time({service_name="gp-api", deployment_environment_name="$ENV"}',
      // Cheap line filter before the alternation, as every sibling log alert does.
      '|= "person_id"',
      '|~ "destination id is already occupied|lost a race to a concurrent write"',
      '[6h]))',
    ].join(' '),
    threshold: 0,
    // No grace period, and none is wanted. The sweep is `0 4 * * *`, so this is
    // one burst a day rather than a signal that can flap across a boundary —
    // a `for` here would only delay the page past the emission that caused it.
    for: '0m',
    // >= the [6h] vector, or the engine's default ten minutes means a rule that
    // only ever sees 03:54-04:04 and reports zero the rest of the day.
    timeRangeSeconds: 21600,
    // 12 re-reads a day. A `0 4 * * *` sweep does not need minute resolution,
    // and a 6h window on the 60s default would re-read those hours 360 times —
    // 360x our ingest for one rule, against an allowance of 100x shared by
    // every rule in both environments. `for` is 0m and nothing retries this, so
    // the only cost is that the page can arrive up to 30 minutes after the
    // nightly sweep emitted the line, on a finding whose remedy is manual.
    evaluationIntervalSeconds: 1800,
    message: [
      'The nightly person-id sweep found a user whose civics id has moved, and could not follow it: the destination id already holds another user’s rows. The link was left stale deliberately, for a human.',
      'Nothing retries this. The stale link survives every subsequent sweep, so the symptom persists until someone acts — that user’s public /people page renders the unclaimed civics spine (wrong name, wrong headshot, no bio) instead of their profile, and if they are under a takedown it silently stops being enforced, because `isRemoved` matches on an id they no longer render under.',
      'Click *View in Grafana* and read `userId`, `from`, `to` and `blocker` off the matched lines. `blocker` names the table standing in the way — `profile`, `removal` or `claim`. Resolve the destination by hand (decide which of the two rows survives, move or delete the loser), then let the 04:00 sweep repoint the link, or call the backfill directly. Afterwards `POST /api/revalidate-person` on BOTH ids, or gp-marketing serves the two versions for up to an hour per edge.',
      'If the two ids turn out to describe DIFFERENT PEOPLE, stop and escalate rather than merging: person clusters are built partly from probabilistic matching, and a collision is one of the few places that surfaces. See ENG-11112.',
    ].join('\n\n'),
    notify: 'win-bugs',
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
    // route-alerts.ts for why that is the one failure a status range
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
    // rules, and at 5m it was still 72x our daily ingest against a query
    // allowance of 100x that every rule and both environments share. At 30m it
    // is 12x. `for` is 30m, so the rule now fires on the first evaluation past
    // the threshold instead of the sixth: detection moves from ~30 minutes
    // after the fifth campaign to ~30-60. This watches a 6h trend with no
    // automatic remedy, so that is the right thing to make slow.
    evaluationIntervalSeconds: 1800,
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
    // `public-person-profiles` had no owner in CONTROLLER_OWNERS at the time,
    // and a controller with no owner gets no route rule at all. It ended when
    // the table it reads was created, not when anyone responded.
    //
    // Same shape as public-campaigns-lookup-error-ratio above. This controller
    // is ALSO in ALERT_OWNERSHIP, so it has a generated route alert too, and
    // the two are not redundant: the generated rule trips on a burst of errors
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
    // THE STRAYS TURNED OUT TO BE THE PROBLEM, which is why the generated rule
    // now needs more than 2 errors in its window (ROUTE_ERROR_THRESHOLDS). The
    // 2 hours in 168 were counted as hours, and an hour holding one transient
    // 502 pages exactly as loudly as an hour holding fifty — so what the
    // measurement read as "twice a week" was mostly single failed requests on
    // a route serving ~150k a day. Re-measured per 10-minute window over the
    // 30 days to 2026-09-18, 18 windows held 1-2 errors and the only windows
    // above that were the two real incidents. THIS rule is what makes raising
    // that safe: it is unchanged, it is what catches the outage the generated
    // rule now sleeps through the first minutes of, and against the August
    // failure it reads 100%. Do not delete it to "simplify" the pair — a test
    // in route-alerts.test.ts fails if you do, and says why.
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
    // route-alerts.ts spells out at `noStatusFilter`: a request the
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
      'Click *View in Grafana* to find the failing requests. The voter-density route reads election-api over HTTP, so a failure there surfaces as a 502 rather than as a database error in this service.',
      'A **null** status means gp-api never wrote one: the request was killed in flight, usually by the gateway’s ~120s idle timeout. Check `responseTimeMs` on those lines — a cluster at ~120,000ms is the timeout rather than the handler, and points at how long the query takes rather than at what it returned.',
    ].join('\n\n'),
  },
  // ------ Our own Grafana Cloud spend ------ //
  //
  // These four exist because on 2026-09-28 the vendor was the first to tell us
  // anything was wrong, and it told us by refusing every Loki query with a 429.
  // 154 alert rules failed to evaluate, `exec_err_state` is `Alerting`
  // (deliberately, and it stays), and every one of them fired at once claiming
  // a specific API route was broken. Production was healthy throughout. The
  // signal we needed was not on any gp-api stream; it was on Grafana Cloud's
  // own usage metrics, which nothing here was reading.
  //
  // They query `grafanacloud-usage`, which is Prometheus and is NOT metered
  // against the log-query allowance they measure. That is the point: a budget
  // alert paid for out of the budget it watches goes silent exactly when it
  // matters.
  {
    slug: 'loki-query-budget-half',
    name: 'Loki query budget half spent',
    type: 'usage',
    // The plan includes log queries up to 100x what we ingest, so ingest is the
    // denominator and the ratio is the only number worth alerting on — an
    // absolute GB/day threshold goes stale the moment log volume moves, in
    // whichever direction.
    //
    // Both sides are averaged over SIX hours, and the pending period is two.
    // An hour was the first guess and it flapped: on 2026-09-29 the 1h ratio
    // swung between 0.79 and 1.5 within a single hour (and spiked to 23 on one
    // ad-hoc query), so it crossed the 0.8 threshold several times an hour and
    // sent a fresh page on every re-cross. `repeat_interval` is 2d, so a
    // sustained firing is one notification — the spam was entirely the
    // resolve/re-fire cycle. Over the same window the 6h ratio is monotone.
    //
    // A long window costs nothing here because of what this measures: the
    // allowance is billed monthly, so the thing worth paging on is a trend that
    // holds for hours. Anything that resolves faster than that was never going
    // to show up on an invoice.
    expr: LOKI_QUERY_BUDGET_RATIO,
    threshold: 0.5,
    for: '120m',
    timeRangeSeconds: 21600,
    message: [
      'Loki log queries are running at more than **50%** of the included allowance (100x ingest), averaged over the last 6 hours. Nothing is broken yet; this is the point at which somebody should look at what is reading.',
      LOKI_ATTRIBUTION_PROSE,
      'The usual cause is a rule whose fetch window is wide and whose evaluation interval is fast — a rule re-reads its whole window every interval, so a 6h window on the 60s default reads the same six hours 1,440 times a day. See gp-api `docs/observability.md` § Query cost.',
    ].join('\n\n'),
  },
  {
    slug: 'loki-query-budget-critical',
    name: 'Loki query budget nearly spent',
    type: 'usage',
    expr: LOKI_QUERY_BUDGET_RATIO,
    threshold: 0.8,
    for: '120m',
    timeRangeSeconds: 21600,
    message: [
      'Loki log queries are running at more than **80%** of the included allowance (100x ingest), averaged over the last 6 hours. Past 100% Grafana Cloud bills the overage and, sustained, starts answering queries with HTTP 429 — at which point every log-backed alert rule fails to evaluate and fires.',
      LOKI_ATTRIBUTION_PROSE,
      '**Reducing log ingest does not fix this.** Ingest is the denominator of the allowance, so writing fewer logs lowers the budget by the same proportion it lowers nothing else. The fix is always a narrower stream selector, a shorter window, or a slower evaluation interval on whatever is doing the reading.',
    ].join('\n\n'),
    notify: BOTH,
  },
  {
    slug: 'loki-stream-count-approaching-cap',
    name: 'Loki active stream count approaching the cap',
    type: 'usage',
    // Against the live limit rather than a constant, because the limit is
    // Grafana's to change and a hardcoded 5,000 would silently misreport the
    // day they raise it. `max` rather than `sum`: both are per-stack gauges and
    // the cap is per-stack too.
    expr: [
      'max(grafanacloud_logs_instance_active_streams)',
      '/',
      'max(grafanacloud_logs_instance_limits{limit_name="max_global_streams_per_user"})',
    ].join(' '),
    threshold: 0.8,
    for: '15m',
    message: [
      'More than **80%** of the Loki active stream cap is in use. Past the cap, Loki rejects writes for new streams — logs are dropped, not queued.',
      'A stream is one distinct combination of stream labels, and the label set is deliberately tiny: `service_name` and `deployment_environment_name`. Nothing that varies per request or per task is in it, so the count should be roughly (services x environments) and should not move when a service scales out.',
      'Grafana Cloud promotes a fixed list of OTel **resource** attributes to stream labels and nothing else, so a new label can only arrive by someone adding a resource attribute in `src/otel.ts`. Check there first.',
    ].join('\n\n'),
    notify: BOTH,
  },
  {
    slug: 'alerting-rule-evaluations-failing',
    name: 'Alert rule evaluations are failing',
    type: 'usage',
    // THE RULE THAT SAYS ALERTING IS BLIND. On 2026-09-28 this ratio was flat 0
    // all day, 4% at 17:10 UTC, 35% at 17:20 and 94% at 17:30; a threshold of
    // 0.2 with `for: 5m` fires once at ~17:20, about a minute after the flood
    // started. Anything between 0.1 and 0.5 catches it identically. Do not go
    // below 0.1 — a single rule failing on a transient is normal.
    //
    // It reads Prometheus rather than Loki deliberately, so that it survives
    // the exact failure it reports.
    //
    // `or on() vector(0)` because the failures counter has no series at all
    // when nothing is failing, and a rule whose expression returns no data
    // reports nothing rather than reporting zero. Stating the zero explicitly
    // is what makes this rule visibly healthy instead of merely quiet.
    expr: [
      '(sum(grafanacloud_grafana_instance_alerting_rule_evaluation_failures_total:rate5m)',
      'or on() vector(0))',
      '/',
      'sum(grafanacloud_grafana_instance_alerting_rule_evaluations_total:rate5m)',
    ].join(' '),
    threshold: 0.2,
    for: '5m',
    message: [
      'More than **20%** of Grafana alert rule evaluations are failing. **Alerting is blind.** Treat every alert currently firing as unverified and every alert currently silent as unchecked — this says nothing about whether any particular route, job or service is healthy.',
      'Rules that cannot evaluate are configured to fire (`exec_err_state: Alerting`), so a burst of identical-looking pages naming different routes is the symptom of this, not of those routes breaking. Read this rule first and the others second.',
      'The likeliest cause is the datasource refusing queries: Loki answers HTTP 429 when the account is far enough past its query allowance, which fails every log-backed rule at once. Check `loki-query-budget-critical`, then Grafana Alerting → the rule list for the actual evaluation error.',
    ].join('\n\n'),
    notify: BOTH,
  },
  {
    slug: 'recorded-metric-not-writing',
    name: 'A recording rule has stopped writing its metric',
    type: 'metric',
    // THE ALERT THAT WOULD HAVE CAUGHT 2026-09-28. Two Grafana-managed
    // recording rules were added that day and never wrote a single datapoint:
    // the writer requires a wide frame and a Loki query returning one series
    // per label set is `timeseries-multi`, which it rejects. The rules reported
    // `health: ok` and `lastError: null` on nearly every poll, because a minute
    // after a failed write there is nothing left to write. 168 alert rules read
    // the metric that did not exist, every one with `noDataState: OK`, and none
    // could fire. Nothing noticed, because a blind alert and a
    // quiet alert look identical.
    //
    // Watching the RULE's health could not have caught it and still cannot.
    // This watches the OUTPUT, which is the only thing that distinguishes a
    // rule that works from a rule that merely runs.
    //
    // It works only because the recording rule ends in `or vector(0)`, so the
    // metric carries an explicit zero in every minute with no spend. Without
    // that, absence means "no door knocking happened", which is most minutes,
    // and this rule would page constantly. Any recording rule added here has to
    // hold the same property or it cannot be watched this way — which is a
    // reason to prefer reading Loki directly, as the route alerts now do.
    //
    // 30 minutes rather than something tighter: the rule writes once a minute,
    // and a handful of consecutive failed evaluations is a transient the ruler
    // recovers from on its own. A gap this long is a broken rule.
    expr: 'absent_over_time(gp_api:door_knocking_credits:sum1m{environment="$ENV"}[30m])',
    threshold: 0,
    // Ten minutes of pending on top of the 30-minute window, so the first
    // deploy after this lands does not page. At that moment the metric has
    // genuinely never existed, `absent_over_time` returns 1, and the rule goes
    // pending — then the recording rule writes its first sample within a minute
    // or two and it resolves without notifying anyone. If the rule does NOT
    // write, the pending period elapses and it pages, which is the whole point.
    //
    // Verified against live Prometheus on 2026-09-29: this expression returns 1
    // today, because the metric does not exist. It is meant to.
    for: '10m',
    // Must cover the range vector or the engine fetches the default ten
    // minutes and `absent_over_time` reports on a window it cannot see.
    timeRangeSeconds: 1800,
    message: [
      'The `gp_api:door_knocking_credits:sum1m` recording rule has written nothing for 30 minutes. **Every Geoapify budget alert is blind.** The four daily budget tiers and the 6h fast-burn ceiling all read this metric, so door-knocking spend is currently unwatched — including the case where the account runs dry and list creation starts answering 502 for every organization at once.',
      'This does not mean spend is high. It means we cannot see spend. Read the raw log line directly while this is broken: `sum(sum_over_time({service_name="gp-api", deployment_environment_name="$ENV"} |= "DoorKnockingSpend" | json | event = "DoorKnockingSpend" | unwrap credits [24h]))` in Explore on `grafanacloud-logs`, against the 50,000-credit pool in `GEOAPIFY_DAILY_CREDIT_POOL`.',
      'Check Grafana Alerting → Recording rules for the rule named `gp-api door-knocking Geoapify credits per minute`. A `health: ok` with no output is the known failure: Grafana rejects a Loki result that is not a single unlabelled series with `unsupported time series type timeseries-multi`, and reports nothing. If the expression has been changed so it can return more than one series, that is the cause. Full history in deploy/components/alerting/provisioned-alerts.ts.',
    ].join('\n\n'),
    notify: WIN,
  },
]
