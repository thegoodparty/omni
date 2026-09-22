import { GLOBAL_ALERTS } from '../alerts'
import { controllerAlerts } from './controller-alerts'
import { CONTROLLER_NAMES } from '../../../src/generated/route-types'

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
