import { Prisma } from '../../generated/prisma'

/**
 * The `where` fragment that every turf lookup owes a caller: scoped to the
 * caller's org, and excluding soft-deleted lists.
 *
 * It exists as one shared value because the two halves fail differently when
 * forgotten. Dropping the org scope is a cross-tenant read, which review and
 * tests catch. Dropping `deletedAt` is invisible — the endpoint keeps working
 * on every list anyone actually has, and only misbehaves on a deleted one, so
 * the miss shows up as a candidate re-knocking a list they deleted rather than
 * as a failing test.
 *
 * Use it for anything that HANDS OUT a turf or its route: the turf reads, the
 * lock assertion, the serve read, the knock freeze. Deliberately NOT for
 * `doorKnockingInteraction.service.ts`, which resolves an already-issued
 * `stopTargetId` so a canvasser can record what happened at a door. The phone
 * snapshots the route and syncs later, so a list deleted mid-walk would make
 * that write 404 and silently discard real field work — the same reasoning
 * that keeps the two suppression writes open after a Pro downgrade. That
 * resolution stays org-scoped, so nothing crosses a tenant; it just does not
 * care whether the list survived the walk.
 */
export const activeTurfScope = (
  organizationSlug: string,
): Pick<
  Prisma.DoorKnockingTurfWhereInput,
  'voterFileFilter' | 'deletedAt'
> => ({
  voterFileFilter: { organizationSlug },
  deletedAt: null,
})

/**
 * The rail's scope, which is the org scope above plus the surface the rail is
 * being drawn on.
 *
 * Only the LIST needs this. Every other turf read is reached by id, and an id
 * the caller already holds cannot be made to cross a surface by asking for it
 * on the wrong one — the org scope is what keeps it inside the tenant, and
 * that is the whole job there.
 *
 * Door knocking could not express this before 3.0. A turf carries no campaign
 * — only an org, through its filter — so an org that holds both a Campaign and
 * an ElectedOffice (the post-election transition) saw one shared rail on both
 * surfaces, which is the ENG-10976 leak `OutreachService.findByScope` exists
 * to prevent for every other channel. The 1:1:1 invariant is what makes it
 * expressible: every turf now has an envelope, and the envelope carries the
 * scope, so the rail filters on `campaignId` through the route exactly the way
 * the outreach history does directly.
 *
 * `campaignId: null` IS the Serve scope, not a missing value — the same
 * dual-scope idiom every other channel uses. Note the join is required in both
 * directions: Prisma's `route: { outreach: { campaignId } }` is an inner join
 * through two relations, so a turf whose chain is broken appears on neither
 * rail rather than on both. `assertRouted` then turns that into a loud error.
 */
export const railTurfScope = (
  organizationSlug: string,
  scope: { campaignId: number | null },
): Prisma.DoorKnockingTurfWhereInput => ({
  ...activeTurfScope(organizationSlug),
  route: { outreach: { campaignId: scope.campaignId } },
})

/**
 * Campaign membership, expressed on the ENVELOPE because that is the only
 * place it exists: the anchor matches on its own id, every sibling on
 * `campaignOutreachId`. Door knocking is the only writer of that column, so
 * this cannot reach another channel's row.
 */
const campaignMembership = (anchorId: number): Prisma.OutreachWhereInput => ({
  OR: [{ id: anchorId }, { campaignOutreachId: anchorId }],
})

/**
 * The campaign's turfs and the campaign's envelopes: the SAME set, seen from
 * the two ends of the 1:1:1 chain. Two values because the read hands back
 * turfs and the lifecycle writes update envelopes.
 *
 * Composed from the same two halves rather than written out twice, and that
 * is the whole point. A campaign-level write's blast radius has to be exactly
 * the list its confirm dialog counted, and two hand-maintained `where`s are
 * how those drift apart. Narrowing either half narrows both.
 */
export const campaignTurfScope = (
  anchorId: number,
  organizationSlug: string,
): Prisma.DoorKnockingTurfWhereInput => ({
  ...activeTurfScope(organizationSlug),
  route: { outreach: campaignMembership(anchorId) },
})

export const campaignEnvelopeScope = (
  anchorId: number,
  organizationSlug: string,
): Prisma.OutreachWhereInput => ({
  ...campaignMembership(anchorId),
  doorKnockingRoute: { turf: activeTurfScope(organizationSlug) },
})
