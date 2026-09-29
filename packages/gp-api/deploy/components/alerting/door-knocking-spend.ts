import { RecordingRule } from './alerts.types'

/**
 * The Prometheus series carrying door-knocking's Geoapify credit spend, one
 * sample per minute.
 */
export const DOOR_KNOCKING_CREDITS_METRIC = 'gp_api:door_knocking_credits:sum1m'

/**
 * One minute of `DoorKnockingSpend` credits, recorded every minute.
 *
 * WHAT THIS REPLACED. Five alert rules read these same log lines from Loki
 * directly: the four Geoapify budget tiers over a 24h window every 15 minutes
 * (96x ingest each — one rule at 96% of the entire allowance, and four of them
 * at 384%) and the 6h fast-burn ceiling every 5 minutes (72x). Measured in prod
 * on 2026-09-29 the tiers alone scanned 1,038 GB/day against a 1,056 GB/day
 * allowance. The comment that used to sit on them claimed Loki's result cache
 * made tiers 2-4 nearly free; the per-rule attribution says otherwise — 13.6,
 * 11.2, 11.2 and 7.2 GB/h, so each one pays close to full price.
 *
 * The pipeline below is character-for-character the one those five rules
 * shared, with the window cut to a minute, so the metric measures what they
 * measured. No `| keep` before the unwrap: the route recording rules need one
 * because they count a line per request and `requestId` would size the inner
 * vector by traffic, whereas `DoorKnockingSpend` is written once per planned
 * route — a few dozen lines a day — and the outer `sum` collapses them anyway.
 *
 * The window ends 60s before now for the reason ROUTE_RECORDING_LAG_SECONDS
 * gives in controller-alerts.ts: log lines reach Loki several seconds after the
 * request they describe, and a window ending at `now` misses them permanently,
 * because the next window starts where this one ended.
 *
 * Deliberately not a member of `RECORDING_RULES` in `provisioned-alerts.ts`,
 * which is where the two lists are joined: `alerts.ts` imports the helper below,
 * and that list has to import `controller-alerts.ts`, which imports `alerts.ts`.
 */
export const DOOR_KNOCKING_SPEND_RECORDING_RULE: RecordingRule = {
  slug: 'door-knocking-credits',
  name: 'gp-api door-knocking Geoapify credits per minute',
  metric: DOOR_KNOCKING_CREDITS_METRIC,
  expr: [
    'sum(sum_over_time(',
    '{service_name="gp-api", deployment_environment_name="$ENV"}',
    '|= "DoorKnockingSpend"',
    '| json',
    '| event = "DoorKnockingSpend"',
    '| unwrap credits',
    '[1m]))',
  ].join(' '),
  fromSeconds: 120,
  toSeconds: 60,
  intervalSeconds: 60,
}

/**
 * Credits spent over `window`, read from the recorded metric.
 *
 * Both the 6h fast-burn ceiling and the four 24h budget tiers go through this,
 * so the two cannot drift into measuring different things — and neither of them
 * touches Loki any more. Widening a window here is free, which is exactly why
 * it should still be a deliberate change.
 *
 * A window with no spend in it returns no data rather than zero, which
 * `grafana.ts` maps to OK. That is the right answer for a budget alarm and it
 * is the behaviour the Loki version had, for the same reason.
 */
export const doorKnockingCredits = (window: string) =>
  `sum_over_time(${DOOR_KNOCKING_CREDITS_METRIC}{environment="$ENV"}[${window}])`
