import { HttpException, HttpStatus } from '@nestjs/common'
import { Prisma } from '../../generated/prisma'

// "500 TOTAL waypoints (ie stops) per day, per user" — the TDD's answer to
// what a reasonable routing limit is, whose stated motivation is one
// customer's usage degrading everyone else's. Geoapify bills 10 credits per
// location against a shared daily pool (~50k), so the budget is enforced per
// organization: that's the unit a turf actually belongs to, and it stops a
// campaign's allowance from multiplying by its number of teammates.
export const DAILY_WAYPOINT_LIMIT = 500

// A rolling window, not a calendar day. Campaigns knock in every US time
// zone and nothing on the organization says which one, so a midnight reset
// would land mid-afternoon for some of them.
const WINDOW_MS = 24 * 60 * 60 * 1000

// Spend is read off the frozen routes themselves rather than a counter
// table: a route is created exactly when the vendor is called, is never
// mutated, and can't be deleted while it exists (deleting its turf 409s), so
// the stop rows already are the ledger.
export const assertWaypointQuota = async (
  tx: Prisma.TransactionClient,
  organizationSlug: string,
  requestedStops: number,
): Promise<void> => {
  const spent = await tx.doorKnockingStop.count({
    where: {
      route: {
        createdAt: { gte: new Date(Date.now() - WINDOW_MS) },
        turf: { voterFileFilter: { organizationSlug } },
      },
    },
  })
  if (spent + requestedStops <= DAILY_WAYPOINT_LIMIT) return

  const remaining = Math.max(0, DAILY_WAYPOINT_LIMIT - spent)
  throw new HttpException(
    `This route needs ${requestedStops} stops and only ${remaining} of your ` +
      `${DAILY_WAYPOINT_LIMIT} daily stops are left. Draw a smaller area, or ` +
      'build this route tomorrow.',
    HttpStatus.TOO_MANY_REQUESTS,
  )
}
