import { Alert } from './alerts.types'

/**
 * Geoapify's whole-account daily credit allowance — the number every tier
 * below is a percentage of.
 *
 * **Confirm this against the plan we actually hold before trusting a tier.**
 * It is not readable from anywhere in the codebase: `GEOAPIFY_API_KEY` is an
 * ECS secret and the allowance lives in Geoapify's billing console, so this is
 * a hand-maintained mirror of a number that changes when someone upgrades.
 *
 * 50,000 is the TDD-sized plan (the $179/month tier), and the figure the
 * existing `door-knocking-route-planner-spend-ceiling` alert already reasons
 * against ("most of Geoapify's ~50k daily pool"), so the two agree. What it is
 * NOT is the free tier's 3,000/day — see gp-api `docs/door-knocking.md`
 * § Procurement, which records the account's provenance as an open question.
 * If we are still on a free key this constant is 16x too high and no tier can
 * fire before the vendor starts refusing routes, which is the failure this
 * whole file exists to prevent. Fix the constant, not the thresholds.
 */
export const GEOAPIFY_DAILY_CREDIT_POOL = 50_000

/**
 * Escalating fractions of that pool. Four rules rather than one because the
 * response differs at each: 60% is a question, 95% is an outage in waiting.
 */
const TIERS = [60, 80, 90, 95] as const

/**
 * Rolling 24h credits across every organization, as one shared expression.
 *
 * **Identical text on all four rules, deliberately.** They differ only in
 * their threshold, so Loki's query-frontend result cache serves tiers 2-4 from
 * the work tier 1 already did — the incremental read cost of the escalation is
 * near zero. Any per-tier edit to this string forfeits that, so if a tier ever
 * needs its own query, give it its own constant and say why.
 *
 * Reads the `DoorKnockingSpend` log line rather than
 * `geoapify_credits_total`, for the reason the 6h ceiling gives
 * and one more. The log is exact and survives the counter reset every deploy
 * causes; and `otel.ts` sets no `service.instance.id`, so every replica exports
 * that counter under one series identity and `increase()` over interleaved
 * cumulative streams is not a number worth paging on.
 *
 * 24h, matching how Geoapify meters. Rolling rather than calendar-aligned
 * because LogQL has no calendar, which makes this a slight over-estimate of
 * any single day — it can span the tail of one and the head of the next. That
 * is the safe direction for a budget alarm, and it is the only respect in
 * which these tiers are pessimistic.
 */
const CREDITS_24H = [
  'sum(sum_over_time(',
  '{service_name="gp-api", deployment_environment_name="$ENV"}',
  // Cheap line filter before | json, as every sibling log alert does.
  '|= "DoorKnockingSpend"',
  '| json',
  '| event = "DoorKnockingSpend"',
  '| unwrap credits',
  '[24h]))',
].join(' ')

const DAY_SECONDS = 86_400

/** What the responder should actually do, which is the point of the tiers. */
const ACTION: Record<(typeof TIERS)[number], string> = {
  60: 'Nothing is broken yet — this is the tier that asks a question. Is this real pilot growth, or one organization looping? If it is growth, the plan is the thing to change, and changing it means changing GEOAPIFY_DAILY_CREDIT_POOL in deploy/components/alerting/geoapify-budget-alerts.ts to match. If it is a loop, you have most of a day to catch it.',
  80: 'Decide now rather than watching. At this share of the pool the account plausibly runs dry before the window rolls, and the remedy with the longest lead time — upgrading the Geoapify plan — is the one that stops being available once it does.',
  90: 'Act. Pull the `native-door-knocking` flag from the heaviest organization, or upgrade the plan. There is no global cap in the code (deliberately — one org must not be able to fail another org’s knock), so nothing but this page is standing between the remaining headroom and an exhausted account.',
  95: 'Treat as an outage in waiting. Once Geoapify refuses, `planRoute` throws and every list creation across every organization answers 502 “Route optimization failed” — door knocking stops working for customers who spent nothing. Pull the flag from the heaviest organizations now and upgrade behind it.',
}

/**
 * Tiered warnings on the whole-account Geoapify allowance.
 *
 * The gap these fill: `assertWaypointQuota` allows one organization 500
 * waypoints per rolling 24h by default and nothing sums across organizations,
 * and the existing `door-knocking-route-planner-spend-ceiling` catches a fast
 * burn (>10,000 credits / 6h) without knowing what the account can afford.
 * Neither answers "how close are we to the wall?", and the wall is hard:
 * Geoapify refuses, `planRoute` throws `BadGatewayException`, and list
 * creation returns 502 for everyone at once regardless of whose spend caused
 * it.
 *
 * The 500 is a default an admin can raise per organization
 * (`override_door_knocking_waypoint_limit`, capped at 5,000 waypoints), which
 * is precisely why these tiers exist rather than a sum of per-org quotas: an
 * override buys no new headroom, it enlarges one org's share of this same
 * fixed pool, and only a measurement of the pool notices.
 *
 * A runaway trips the 6h ceiling first and these later, which is the intended
 * ordering — that one measures rate, these measure budget.
 *
 * **Per environment, while the allowance may not be.** The stream selector
 * pins `$ENV`, so dev and prod each measure only themselves; if they share one
 * `GEOAPIFY_API_KEY` they are spending one pool and the true consumption is
 * the sum. Real headroom is then smaller than any tier reports, which is part
 * of why the first tier sits at 60% rather than somewhere more comfortable.
 */
export const geoapifyBudgetAlerts: Alert[] = TIERS.map((percent) => ({
  slug: `geoapify-daily-budget-${percent}`,
  name: `[Win] Geoapify daily credit budget ${percent}% consumed`,
  type: 'log',
  expr: CREDITS_24H,
  threshold: Math.round((GEOAPIFY_DAILY_CREDIT_POOL * percent) / 100),
  // Longer grace on the advisory tiers than the urgent ones. A rolling sum
  // steps up in bursts and decays as old spend ages out, so a boundary can be
  // crossed twice in a few minutes; 30m keeps that out of #dev-alerts where
  // there is a day to react, and 90/95 trade the quiet for speed.
  //
  // Both are whole multiples of the interval below, which is what `for`
  // actually counts in — a `for` that does not divide by it silently waits
  // until the next evaluation, and the number here would stop being the delay
  // a reader gets.
  for: percent >= 90 ? '15m' : '30m',
  // The [24h] vector needs a fetch window to match, or the engine sees the
  // default ten minutes and the sum never accumulates.
  timeRangeSeconds: DAY_SECONDS,
  // Loki bills the bytes an evaluation decompresses and an evaluation
  // decompresses its whole fetch window, so a day-wide rule on the 60s default
  // would re-read 24h of logs 1,440 times a day — the single largest line in
  // the query bill, and the thing `MAX_REREAD_FACTOR` exists to prevent. At
  // 15m it is 96 re-reads, just inside that ceiling.
  //
  // This is why the urgent tiers cannot react in 5m: nothing below 864s keeps
  // a 24h window under the ceiling, and the window is not negotiable because
  // it is how Geoapify meters. A budget alarm with a day of headroom is the
  // right thing to make slow.
  evaluationIntervalSeconds: 900,
  message: [
    `Door knocking has spent more than ${percent}% of Geoapify’s daily credit allowance (${Math.round(
      (GEOAPIFY_DAILY_CREDIT_POOL * percent) / 100,
    ).toLocaleString('en-US')} of ${GEOAPIFY_DAILY_CREDIT_POOL.toLocaleString(
      'en-US',
    )} credits) in the last 24 hours, across all organizations.`,
    ACTION[percent],
    'Click *View in Grafana* for the DoorKnockingSpend lines, then group by organization to find the source: `sum by (organizationSlug) (sum_over_time({service_name="gp-api", deployment_environment_name="$ENV"} |= "DoorKnockingSpend" | json | event = "DoorKnockingSpend" | unwrap credits [24h]))`. A single organization above 5,000 is over the default quota, which is either the ENG-10901 overshoot or an admin-granted override — check `override_door_knocking_waypoint_limit` on the org before treating it as a bug. Queries and the per-org breakdown are in gp-api docs/door-knocking.md § Spend visibility.',
    `The allowance is a hand-maintained constant (GEOAPIFY_DAILY_CREDIT_POOL, currently ${GEOAPIFY_DAILY_CREDIT_POOL.toLocaleString(
      'en-US',
    )}), not something gp-api can read. If all four tiers fired at once, suspect the constant before the spend — a free-tier key is 3,000/day.`,
  ].join('\n\n'),
  notify: 'win-bugs',
}))
