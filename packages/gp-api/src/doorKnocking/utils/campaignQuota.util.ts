import { HttpException, HttpStatus } from '@nestjs/common'
import { Prisma } from '../../generated/prisma'

// Five door-knocking campaigns per organization per day, and the second of
// the feature's two daily gates. The waypoint budget beside it caps how many
// doors get routed; this caps how many separate turfs get cut, which a stop
// count cannot express — five two-stop turfs and one ten-stop turf spend the
// same waypoint allowance and are not the same behaviour. Every turf is a
// paid Geoapify route and a list nobody has walked yet, so an afternoon spent
// carving the map into lists is backlog being built rather than knocked.
//
// Flat for every organization. The waypoint limit carries an admin override
// on the org row; this one deliberately does not, so there is nothing to
// resolve and the constant is the whole answer.
export const DAILY_CAMPAIGN_LIMIT = 5

// A rolling window, not a calendar day. Campaigns knock in every US time
// zone and nothing on the organization says which one, so a midnight reset
// would land mid-afternoon for some of them.
const WINDOW_MS = 24 * 60 * 60 * 1000

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
// transaction: the draw step's advisory read, and the number the create flow
// refuses to open on. Clamped, because an overshoot (see the assert below)
// is a real state and "-1 campaigns left" is not something to render.
export const campaignsRemaining = async (
  client: Prisma.TransactionClient,
  organizationSlug: string,
): Promise<number> =>
  Math.max(
    0,
    DAILY_CAMPAIGN_LIMIT - (await campaignsCreated(client, organizationSlug)),
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
// Nothing serializes two creates in one organization, exactly as nothing
// serializes them for the waypoint budget: simultaneous presses can each pass
// this and overshoot by a campaign. An org-wide lock would queue every create
// behind a 30-second vendor call, which is the wrong trade for a limit that
// paces list-building rather than bounding spend to the credit.
export const assertCampaignQuota = async (
  tx: Prisma.TransactionClient,
  organizationSlug: string,
): Promise<void> => {
  const created = await campaignsCreated(tx, organizationSlug)
  if (created <= DAILY_CAMPAIGN_LIMIT) return

  throw new HttpException(
    `You've created ${DAILY_CAMPAIGN_LIMIT} door knocking campaigns today. ` +
      "Go knock the doors you've already mapped, and build more lists " +
      'tomorrow.',
    HttpStatus.TOO_MANY_REQUESTS,
  )
}
