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
