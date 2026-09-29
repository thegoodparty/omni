import { GLOBAL_ALERTS } from '../alerts'
import { RecordingRule } from './alerts.types'
import { controllerAlerts, ROUTE_RECORDING_RULES } from './controller-alerts'
import { DOOR_KNOCKING_SPEND_RECORDING_RULE } from './door-knocking-spend'
import { LOG_SIGNAL_RECORDING_RULES } from './log-signals'
import { CONTROLLER_NAMES } from '../../../src/generated/route-types'

/**
 * Every scheduled read of a Loki stream this repo provisions.
 *
 * WHY THEY ARE ENUMERATED IN ONE PLACE, and why the enumeration is checked. A
 * Loki-backed rule re-reads its whole fetch window on every evaluation, and
 * only the stream selector and that window decide the bytes — so a rule's daily
 * read volume, as a multiple of what we ingest, is exactly `window ÷ interval`.
 * The plan includes log queries up to 100x ingest, and that allowance is
 * shared: by every rule, by both environments, and by whatever a human types
 * into Explore. A limit that is only ever applied one rule at a time therefore
 * cannot say whether the estate fits, which is how four rules that each passed
 * a 100x per-rule ceiling came to be budgeted at 384% of the whole allowance
 * and spent 4.4x of it (2026-09-29).
 *
 * It is also not enough to bound the factor, which is the second thing that day
 * taught us. A rule's cost scales with the volume of the stream it selects,
 * while the allowance scales with total account ingest — so the same rules cost
 * 3.5x more of the allowance at midday than at 07:00, and a budget that fits
 * overnight does not fit at peak. See the header in `log-signals.ts`.
 *
 * A recording rule is the way out of that arithmetic: it reads one minute of
 * logs once a minute — the floor, 1x ingest — writes the result to Prometheus,
 * and every alert that wants a wider window assembles it there, where the read
 * costs nothing. Its cost does not grow with the number of alerts consuming it,
 * with how wide a window they ask for, or with how often they evaluate.
 *
 * `global-alerts.test.ts` sums `window ÷ interval` across these and the
 * log-backed alerts and fails when the total leaves too little of the allowance
 * for anything else.
 */
export const RECORDING_RULES: RecordingRule[] = [
  ...ROUTE_RECORDING_RULES,
  DOOR_KNOCKING_SPEND_RECORDING_RULE,
  ...LOG_SIGNAL_RECORDING_RULES,
]

/**
 * Every alert slug this repo provisions, from both sources.
 *
 * ONE COPY, for the same reason `EXPECTED_PROD_RECEIVERS` is one copy. The
 * routing guard is only as good as the list of alerts it walks: enumerate the
 * slugs separately in the deploy check and in the test suite, and adding a
 * third source of alerts to one of them leaves the other silently walking a
 * stale set — the tests pass while the deploy checks the wrong thing, or the
 * deploy is right and no PR can fail on it.
 *
 * Its own module rather than a member of `alerts.ts`, because
 * `controller-alerts.ts` imports from there and importing it back would be a
 * cycle; and rather than a member of `alert-routing.ts`, because that file is a
 * pure simulator that deliberately knows nothing about this repo's alerts.
 */
export const provisionedAlertSlugs = (): string[] => [
  ...GLOBAL_ALERTS.map((alert) => alert.slug),
  ...CONTROLLER_NAMES.flatMap((controller) =>
    controllerAlerts(controller).map((alert) => alert.slug),
  ),
]
