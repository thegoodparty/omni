import { Prisma } from '../../generated/prisma'

/**
 * The `where` fragment that every turf lookup owes a caller: scoped to the
 * caller's org, and excluding soft-deleted lists.
 *
 * It exists as one shared value because the two halves fail differently when
 * forgotten. Dropping the org scope is a cross-tenant read, which review and
 * tests catch. Dropping `deletedAt` is invisible — the endpoint keeps working
 * on every list anyone actually has, and only misbehaves on a deleted one, so
 * the miss shows up as a candidate knocking a list they deleted rather than as
 * a failing test. Four call sites across three services need it (turf get and
 * lock assertion, the serve read, the knock freeze); a fifth added later would
 * have no reason to know that.
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
