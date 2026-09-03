import { HttpException, HttpStatus } from '@nestjs/common'
import { Organization, Prisma } from '../../generated/prisma'

// "500 TOTAL waypoints (ie stops) per day, per user" — the TDD's answer to
// what a reasonable routing limit is, whose stated motivation is one
// customer's usage degrading everyone else's. A stop draws roughly 11 credits
// against a shared daily pool (~50k) — ten for its Route Planner location
// once a route clears ten of them, plus its share of the path-geometry
// Routing call — so the budget is enforced per organization: that's the unit
// a turf actually belongs to, and it stops a campaign's allowance from
// multiplying by its number of teammates.
//
// It is where an organization starts, not where it has to stay: an admin can
// raise a single organization through `PATCH /v1/organizations/admin/:slug`,
// which writes `overrideDoorKnockingWaypointLimit` on the org row.
export const DEFAULT_DAILY_WAYPOINT_LIMIT = 500

// The ceiling on an override: one organization allowed the whole account's
// assumed daily Geoapify pool (~50,000 credits) and no more. Above it the
// number is unhonourable no matter which org asks, so it is refused at
// validation rather than discovered at the vendor.
//
// 5,000 stops is the pool converted at ten credits a stop, which is what a
// route's Route Planner locations cost and not what a route costs: each one
// also pays for its anchors and for the Routing call behind the path
// geometry, putting 5,000 stops nearer 55,000 credits. So this grants
// slightly more than the pool it is derived from. Left as it stands because
// re-sizing an admin-facing limit is a decision about what one organization
// may spend, not an arithmetic correction.
export const MAX_DAILY_WAYPOINT_LIMIT = 5_000

// A rolling window, not a calendar day. Campaigns knock in every US time
// zone and nothing on the organization says which one, so a midnight reset
// would land mid-afternoon for some of them.
const WINDOW_MS = 24 * 60 * 60 * 1000

// What this organization is allowed today. The one place the override is
// resolved, so the ledger sum, the 429's wording and the preview's advisory
// number cannot disagree about which limit applies.
export const dailyWaypointLimit = (
  organization: Pick<Organization, 'overrideDoorKnockingWaypointLimit'>,
): number =>
  organization.overrideDoorKnockingWaypointLimit ?? DEFAULT_DAILY_WAYPOINT_LIMIT

// The organization rather than its slug, because the allowance is now
// something the row carries and the ledger sum alone no longer answers it.
type QuotaOrganization = Pick<
  Organization,
  'slug' | 'overrideDoorKnockingWaypointLimit'
>

// Spend comes from the append-only ledger, not from the frozen routes. Reading
// it off door_knocking_stop assumed a route exists whenever the vendor was
// called, which is false for any purchase that rolls back after the paid call
// — the money left, the stops never landed, and the same allowance was handed
// out again. recordWaypointSpend writes the ledger outside that transaction.
export const waypointsRemaining = async (
  client: Prisma.TransactionClient,
  organization: QuotaOrganization,
): Promise<number> => {
  const window = await client.doorKnockingRoutePlannerSpend.aggregate({
    where: {
      organizationSlug: organization.slug,
      occurredAt: { gte: new Date(Date.now() - WINDOW_MS) },
    },
    _sum: { waypoints: true },
  })
  return Math.max(
    0,
    dailyWaypointLimit(organization) - (window._sum.waypoints ?? 0),
  )
}

// `tx` rather than a plain client so the check runs on the same connection as
// the create transaction it guards.
//
// The draw step reports the same allowance through the address preview and
// disables Build route when the turf will not fit, so in practice this is not
// where a candidate meets the limit — which matters, because the remedy is
// waiting out a 24-hour window and this throws AFTER they have committed to a
// name, a shape and a travel mode. It stays as the authority: the preview is
// an advisory read taken earlier, and a second turf bought in between can
// spend the allowance it reported.
export const assertWaypointQuota = async (
  tx: Prisma.TransactionClient,
  organization: QuotaOrganization,
  requestedStops: number,
): Promise<void> => {
  const remaining = await waypointsRemaining(tx, organization)
  if (requestedStops <= remaining) return

  throw new HttpException(
    `This route needs ${requestedStops} stops and only ${remaining} of your ` +
      `${dailyWaypointLimit(organization)} daily stops are left. Draw a ` +
      'smaller area, or build this route tomorrow.',
    HttpStatus.TOO_MANY_REQUESTS,
  )
}

// Written the moment the vendor returns. `client` must be the plain Prisma
// client, NOT the knock transaction's `tx` — committing independently of that
// transaction is the entire point, since a spend recorded inside it is a spend
// the budget forgets the moment it rolls back.
//
// A slug and not the organization: this appends to the ledger and has no
// business reading what the org is entitled to.
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
