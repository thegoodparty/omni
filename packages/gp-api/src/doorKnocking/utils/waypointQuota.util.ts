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

// Spend comes from the append-only ledger, not from the frozen routes. Reading
// it off door_knocking_stop assumed a route exists whenever the vendor was
// called, which is false for any knock that rolls back after the paid call —
// the money left, the stops never landed, and the same allowance was handed out
// again. recordWaypointSpend writes the ledger outside that transaction.
//
// `tx` rather than a plain client so the check runs on the same connection as
// the advisory lock that serializes concurrent knocks on a turf.
export const assertWaypointQuota = async (
  tx: Prisma.TransactionClient,
  organizationSlug: string,
  requestedStops: number,
): Promise<void> => {
  const window = await tx.doorKnockingRoutePlannerSpend.aggregate({
    where: {
      organizationSlug,
      occurredAt: { gte: new Date(Date.now() - WINDOW_MS) },
    },
    _sum: { waypoints: true },
  })
  const spent = window._sum.waypoints ?? 0
  if (spent + requestedStops <= DAILY_WAYPOINT_LIMIT) return

  const remaining = Math.max(0, DAILY_WAYPOINT_LIMIT - spent)
  throw new HttpException(
    `This route needs ${requestedStops} stops and only ${remaining} of your ` +
      `${DAILY_WAYPOINT_LIMIT} daily stops are left. Draw a smaller area, or ` +
      'build this route tomorrow.',
    HttpStatus.TOO_MANY_REQUESTS,
  )
}

// Written the moment the vendor returns. `client` must be the plain Prisma
// client, NOT the knock transaction's `tx` — committing independently of that
// transaction is the entire point, since a spend recorded inside it is a spend
// the budget forgets the moment it rolls back.
//
// Callers own the failure: the vendor has already been paid by the time this
// runs, so a write failure here must be logged rather than allowed to turn
// billed work into a failed knock.
export const recordWaypointSpend = async (
  client: Prisma.TransactionClient,
  spend: {
    organizationSlug: string
    doorKnockingTurfId: number
    waypoints: number
    credits: number
  },
): Promise<void> => {
  await client.doorKnockingRoutePlannerSpend.create({ data: spend })
}
