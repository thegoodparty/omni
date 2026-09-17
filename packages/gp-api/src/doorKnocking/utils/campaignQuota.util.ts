import { HttpException, HttpStatus } from '@nestjs/common'
import { Organization, Prisma } from '../../generated/prisma'

// Five door-knocking campaigns per organization per day, and now the feature's
// only per-account limit. A 500-stop daily budget used to sit beside it and
// has been removed: two ceilings on one press meant a candidate could be
// refused for either reason and the flow had to explain both, and of the two
// this is the one that describes the behaviour worth pacing. Every turf is a
// paid Geoapify route and a list nobody has walked yet, so an afternoon spent
// carving the map into lists is backlog being built rather than knocked — and
// a stop count cannot express that, since five two-stop turfs and one ten-stop
// turf spent the same waypoint allowance and are not the same behaviour.
//
// What replaced the stop budget is not another cap but visibility: spend is
// still recorded per route (waypointSpend.util.ts) and the account-wide total
// is alerted on in tiers. The shared credit pool is bounded by watching it,
// not by rationing each org against a number nobody could set correctly.
//
// It is where an organization starts, not where it has to stay: an admin can
// raise a single organization through `PATCH /v1/organizations/admin/:slug`,
// which writes `overrideDoorKnockingCampaignLimit` on the org row.
export const DEFAULT_DAILY_CAMPAIGN_LIMIT = 5

// The ceiling on an override: one organization allowed roughly the whole
// account's assumed daily Geoapify pool (~50,000 credits) and no more. Above
// it the number is unhonourable whichever org asks, so it is refused at
// validation rather than discovered at the vendor.
//
// Derived, not chosen: a campaign is capped at MAX_STOPS (150) stops, and a
// stop draws about eleven credits — ten for its Route Planner location plus
// its share of the path-geometry Routing call — so a full-sized campaign is
// near 1,650 credits and thirty of them is about the pool. Most campaigns are
// far smaller, so in practice thirty is well under it; the point is that no
// admin can hand one organization an allowance the account cannot fund even
// in the worst case.
export const MAX_DAILY_CAMPAIGN_LIMIT = 30

// A rolling window, not a calendar day. Campaigns knock in every US time
// zone and nothing on the organization says which one, so a midnight reset
// would land mid-afternoon for some of them.
const WINDOW_MS = 24 * 60 * 60 * 1000

// The organization rather than its slug, because the allowance is something
// the row carries and a count alone no longer answers it.
type QuotaOrganization = Pick<
  Organization,
  'slug' | 'overrideDoorKnockingCampaignLimit'
>

// What this organization is allowed today. The one place the override is
// resolved, so the count, the 429's wording and the create flow's own
// advisory number cannot disagree about which limit applies.
export const dailyCampaignLimit = (
  organization: Pick<Organization, 'overrideDoorKnockingCampaignLimit'>,
): number =>
  organization.overrideDoorKnockingCampaignLimit ?? DEFAULT_DAILY_CAMPAIGN_LIMIT

// A turf carries no organization of its own — it reaches one through its
// saved filter — so the window is counted across the same join every other
// turf read takes.
//
// Soft-deleted turfs are counted, and the missing `deletedAt: null` is the
// point rather than an oversight. `deletedAt` is a tombstone over a route
// that was billed at creation and is documented as never re-bought, so the
// spend happened whether or not the row was later shelved. Filtering them out
// would also make Delete the way to buy unlimited routes: create, delete,
// repeat, and the same allowance is handed out again under a different name.
const campaignsCreated = (
  client: Prisma.TransactionClient,
  organizationSlug: string,
): Promise<number> =>
  client.doorKnockingTurf.count({
    where: {
      voterFileFilter: { organizationSlug },
      createdAt: { gte: new Date(Date.now() - WINDOW_MS) },
    },
  })

// What the organization has left, for a caller outside the create
// transaction: the number the create flow refuses to open on. Clamped,
// because an overshoot (see the assert below) is a real state and
// "-1 campaigns left" is not something to render.
export const campaignsRemaining = async (
  client: Prisma.TransactionClient,
  organization: QuotaOrganization,
): Promise<number> =>
  Math.max(
    0,
    dailyCampaignLimit(organization) -
      (await campaignsCreated(client, organization.slug)),
  )

// `tx` rather than a plain client so the check runs on the same connection as
// the create transaction it guards.
//
// Counted rather than read off `campaignsRemaining`, and that is the whole
// reason this does not simply test it for zero. The create transaction
// inserts its turf BEFORE reaching this gate — the row has to exist so the
// spend ledger can name the turf that caused the charge — so the count here
// already includes the campaign being created: the fifth of a window sees
// five and is allowed, the sixth sees six and is not. Both land on a clamped
// remaining of zero, so the remaining figure cannot tell them apart.
//
// Nothing serializes two creates in one organization: simultaneous presses
// can each pass this and overshoot by a campaign. An org-wide lock would
// queue every create behind a 30-second vendor call, which is the wrong trade
// for a limit that paces list-building rather than bounding spend to the
// credit — the account-wide alerts are what bound the spend.
export const assertCampaignQuota = async (
  tx: Prisma.TransactionClient,
  organization: QuotaOrganization,
): Promise<void> => {
  const limit = dailyCampaignLimit(organization)
  const created = await campaignsCreated(tx, organization.slug)
  if (created <= limit) return

  throw new HttpException(
    `You've created ${limit} door knocking campaigns today. ` +
      "Go knock the doors you've already mapped, and build more lists " +
      'tomorrow.',
    HttpStatus.TOO_MANY_REQUESTS,
  )
}
