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
 * The window ends 60s before now because log lines reach Loki several seconds
 * after the request they describe: pino hands the line to the OTel SDK,
 * `BatchLogRecordProcessor` holds it for up to its scheduled delay, and then it
 * is exported. A window ending at `now` misses those lines permanently, because
 * the next window starts where this one ended. Reading a window that has
 * already closed costs exactly the same and cannot drop anything.
 *
 * THE ONLY RECORDING RULE LEFT, and the only one whose shape can work. Grafana's
 * recording-rule writer needs a wide frame; a Loki instant query returning one
 * series per label set is `timeseries-multi` and is rejected with `unsupported
 * time series type timeseries-multi`. That is what silently killed the two
 * route recording rules for a month. This query aggregates with a bare `sum()`
 * to a single unlabelled series, which is the shape the writer accepts.
 *
 * `or vector(0)` IS LOAD-BEARING AND IS NOT COSMETIC. Without it the rule
 * writes nothing in any minute with no door-knocking spend, which is most
 * minutes — and a metric that is absent because nothing was spent is
 * indistinguishable from a metric that is absent because the rule is broken.
 * That is the exact confusion that let a dead recording rule look healthy.
 * Writing an explicit zero every minute makes absence mean one thing, which is
 * what `recorded-metric-not-writing` in alerts.ts alerts on. Verified against
 * prod Loki: the clause returns a single unlabelled `0` when the pipeline
 * matches no lines.
 *
 * Deliberately not a member of `RECORDING_RULES` in `provisioned-alerts.ts`,
 * which is where the two lists are joined: `alerts.ts` imports the helper below,
 * and that list has to import `route-alerts.ts`, which imports `alerts.ts`.
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
    '[1m])) or vector(0)',
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
 * A window with no spend in it now sums to zero rather than returning no data,
 * because the recording rule writes an explicit zero every minute. Both answer
 * OK on a `> threshold` comparison, so no alert changes behaviour; what changes
 * is that these five rules reporting nothing is now a detectable state rather
 * than the steady one.
 */
export const doorKnockingCredits = (window: string) =>
  `sum_over_time(${DOOR_KNOCKING_CREDITS_METRIC}{environment="$ENV"}[${window}])`
