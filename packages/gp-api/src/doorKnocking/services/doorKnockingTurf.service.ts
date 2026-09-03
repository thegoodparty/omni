import { Injectable, NotFoundException } from '@nestjs/common'
import {
  DoorKnockingTurf,
  UpdateDoorKnockingTurf,
} from '@goodparty_org/contracts'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { OutreachStatus, Prisma } from '../../generated/prisma'
import { lockTurf } from '../utils/turfLock.util'
import { activeTurfScope, railTurfScope } from '../utils/turfScope.util'
import {
  DoorKnockingTurfCounts,
  DoorKnockingTurfCountsService,
} from './doorKnockingTurfCounts.service'

// `totalSeconds` rides the same row the id comes from, so the rail's duration
// costs nothing beyond the column: it is the route's OWN travel time, already
// frozen when the list was created, and not a second estimate computed here.
//
// The envelope comes along on the same include because it is now where the
// lifecycle lives. It is reached through the route rather than by a column on
// the turf, which is the join that has always been there — the route's
// `doorKnockingTurfId` is `@unique`, so the hop is one step in either
// direction and no column was ever needed for it.
const ROUTE_INCLUDE = {
  route: {
    select: {
      id: true,
      totalSeconds: true,
      outreach: { select: { status: true, archivedAt: true } },
    },
  },
} as const satisfies Prisma.DoorKnockingTurfInclude

type TurfWithRoute = Prisma.DoorKnockingTurfGetPayload<{
  include: typeof ROUTE_INCLUDE
}>

// Every turf is created with its route and envelope in one transaction, so
// both are present on every row this service can read. Prisma still types them
// as nullable — the FKs point the other way, and it cannot know the two are
// written together — so this narrows once, at the read boundary, rather than
// leaving every caller to re-answer a question the model has already settled.
type RoutedTurf = TurfWithRoute & {
  route: NonNullable<TurfWithRoute['route']> & {
    outreach: NonNullable<NonNullable<TurfWithRoute['route']>['outreach']>
  }
}

const NO_COUNTS: DoorKnockingTurfCounts = {
  doorCount: 0,
  knockedDoorCount: 0,
  peopleCount: 0,
  loggedCount: 0,
}

const toResponse = (
  turf: RoutedTurf,
  counts: DoorKnockingTurfCounts = NO_COUNTS,
): DoorKnockingTurf => ({
  id: turf.id,
  voterFileFilterId: turf.voterFileFilterId,
  name: turf.name,
  color: turf.color,
  geoPoly: turf.geoPoly,
  doorCount: counts.doorCount,
  knockedDoorCount: counts.knockedDoorCount,
  peopleCount: counts.peopleCount,
  loggedCount: counts.loggedCount,
  routeSeconds: turf.route.totalSeconds,
  completed: turf.route.outreach.status === OutreachStatus.completed,
  archivedAt: turf.route.outreach.archivedAt,
  createdAt: turf.createdAt,
  updatedAt: turf.updatedAt,
})

// A turf whose route or envelope is missing cannot be produced by any code
// path 3.0 has, and the migration removed the rows that predate it. Throwing
// rather than degrading is the point: a silent fallback here would put a list
// on the rail with no doors and no lifecycle, which reads as data loss and
// hides the schema violation that caused it.
const assertRouted = (turf: TurfWithRoute): RoutedTurf => {
  const { route } = turf
  if (!route?.outreach) {
    throw new Error(
      `Door-knocking turf ${turf.id} has no route or no outreach envelope; ` +
        'every turf is created with both in one transaction',
    )
  }
  return { ...turf, route: { ...route, outreach: route.outreach } }
}

@Injectable()
export class DoorKnockingTurfService extends createPrismaBase(
  MODELS.DoorKnockingTurf,
) {
  constructor(private readonly counts: DoorKnockingTurfCountsService) {
    super()
  }

  // The rail is the first screen a candidate lands on, so the counts ride the
  // list rather than costing a fetch per row: ONE batched aggregate across
  // every turf on the rail, whatever the list count.
  //
  // Scoped by surface as well as by org — see `railTurfScope`. This is the one
  // read that needs it, and 3.0 is the first version that can express it.
  //
  // Archived turfs are returned, carrying `archivedAt`, rather than filtered
  // out here, because `door-knocking/print/walkListData.ts` resolves a turf's
  // NAME by scanning this endpoint — hiding a row would silently degrade its
  // PDF to the "Walk list" fallback while the sheet itself still printed fine.
  // The rail does its own filtering. Soft-deleted turfs are a different case
  // and really are gone.
  async list(
    organizationSlug: string,
    scope: { campaignId: number | null },
  ): Promise<DoorKnockingTurf[]> {
    const rows = await this.model.findMany({
      where: railTurfScope(organizationSlug, scope),
      orderBy: { name: 'asc' },
      include: ROUTE_INCLUDE,
    })
    const turfs = rows.map(assertRouted)
    const counts = await this.counts.forRoutes(
      organizationSlug,
      turfs.map((turf) => turf.route.id),
    )
    return turfs.map((turf) => toResponse(turf, counts.get(turf.route.id)))
  }

  // A soft-deleted turf is indistinguishable from one that never existed, so
  // this 404s it like any other miss — same as a turf that isn't yours.
  async findForOrganization(
    id: number,
    organizationSlug: string,
  ): Promise<RoutedTurf> {
    const turf = await this.model.findFirst({
      where: { id, ...activeTurfScope(organizationSlug) },
      include: ROUTE_INCLUDE,
    })
    if (!turf) {
      throw new NotFoundException('Turf not found')
    }
    return assertRouted(turf)
  }

  // Same aggregate over one route. Every turf has one, so unlike the old
  // version there is no branch here that can answer without counts.
  async get(id: number, organizationSlug: string): Promise<DoorKnockingTurf> {
    const turf = await this.findForOrganization(id, organizationSlug)
    return this.withCounts(turf, organizationSlug)
  }

  // Name and colour only — the contract has no other fields to offer. The
  // polygon is what the frozen route was computed from, so it is not editable
  // at all now that every turf carries one; the old `assertNotLocked` guard
  // that used to reject the whole update is gone with the unlocked state it
  // tested for. Refusing the rename too would mean a typo outlives the walk.
  async update(
    id: number,
    organizationSlug: string,
    input: UpdateDoorKnockingTurf,
  ): Promise<DoorKnockingTurf> {
    const turf = await this.model.update({
      where: { id, voterFileFilter: { organizationSlug }, deletedAt: null },
      data: input,
      include: ROUTE_INCLUDE,
    })
    return this.withCounts(assertRouted(turf), organizationSlug)
  }

  // Always a tombstone. Every turf has a route someone was billed for, frozen
  // addresses, and the name snapshots privacy deletion relies on; hard-deleting
  // one would cascade all of that plus the Outreach envelope, silently removing
  // the walk from outreach history. So the row is left intact underneath and
  // dropped from every read path. The hard-delete branch that used to run for
  // an unbought drawing has nothing left to match — 3.0 has no such turf, and
  // the migration removed the ones that predate it. The knock interactions
  // survive either way: they hang off the organization, not this chain.
  async delete(id: number, organizationSlug: string): Promise<void> {
    await this.client.$transaction(async (tx) => {
      const turf = await this.lockAndFind(tx, id, organizationSlug)
      await tx.doorKnockingTurf.update({
        where: { id: turf.id },
        data: { deletedAt: new Date() },
      })
    })
  }

  // "End knocking session", written straight onto the envelope, which is the
  // only place the lifecycle lives. There is no second row to mirror it onto
  // and therefore nothing left to drift — the guard ordering, the shared
  // timestamp and the unconditional repair write that used to be here were all
  // consequences of having two.
  //
  // Idempotent by early return rather than by writing `completed` over
  // `completed`, which would look equivalent: the envelope carries an
  // `updatedAt`, and the outreach history sorts and reports off the row, so a
  // stray second tap on a finished list must not touch it at all.
  async complete(
    id: number,
    organizationSlug: string,
  ): Promise<DoorKnockingTurf> {
    const turf = await this.client.$transaction(async (tx) => {
      const locked = await this.lockAndFind(tx, id, organizationSlug)
      if (locked.route.outreach.status === OutreachStatus.completed) {
        return locked
      }

      await tx.outreach.update({
        where: { doorKnockingRouteId: locked.route.id },
        data: { status: OutreachStatus.completed },
      })
      return this.restamp(locked, { status: OutreachStatus.completed })
    })
    return this.withCounts(turf, organizationSlug)
  }

  // Archive is a shelf, not a state machine step: it deliberately does NOT
  // require a completed list. The design only offers it after Done, but a
  // candidate who abandons a half-walked list still needs it off the rail, and
  // refusing that would leave delete as the only way out.
  //
  // Idempotent in the archiving direction because the card renders "archived
  // since" and a retry must not walk that date forward. Un-archiving has
  // nothing to preserve — it writes null either way.
  async setArchived(
    id: number,
    organizationSlug: string,
    archived: boolean,
  ): Promise<DoorKnockingTurf> {
    const turf = await this.client.$transaction(async (tx) => {
      const locked = await this.lockAndFind(tx, id, organizationSlug)
      const current = locked.route.outreach.archivedAt
      const archivedAt = archived ? (current ?? new Date()) : null
      if (archivedAt === current) return locked

      await tx.outreach.update({
        where: { doorKnockingRouteId: locked.route.id },
        data: { archivedAt },
      })
      return this.restamp(locked, { archivedAt })
    })
    return this.withCounts(turf, organizationSlug)
  }

  // The advisory lock still serializes the three turf mutations against each
  // other, so archive cannot land between delete's read and its write. What it
  // no longer has to hold off is a knock freezing a route mid-transaction:
  // routes are bought at creation, when nothing else can name the turf yet.
  private async lockAndFind(
    tx: Prisma.TransactionClient,
    id: number,
    organizationSlug: string,
  ): Promise<RoutedTurf> {
    await lockTurf(tx, id)
    const turf = await tx.doorKnockingTurf.findFirst({
      where: { id, ...activeTurfScope(organizationSlug) },
      include: ROUTE_INCLUDE,
    })
    if (!turf) {
      throw new NotFoundException('Turf not found')
    }
    return assertRouted(turf)
  }

  // Folds a lifecycle write back into the row that was read under the lock,
  // rather than re-reading it. A re-read after the transaction would race a
  // concurrent delete — the turf would be tombstoned in the gap and the
  // re-read, which filters `deletedAt: null`, would 404 an operation that
  // actually succeeded. Nothing can change the envelope while the lock is
  // held, so patching the two fields locally says the same thing as a query.
  private restamp(
    locked: RoutedTurf,
    outreach: Partial<RoutedTurf['route']['outreach']>,
  ): RoutedTurf {
    return {
      ...locked,
      route: {
        ...locked.route,
        outreach: { ...locked.route.outreach, ...outreach },
      },
    }
  }

  // Counts are deliberately read OUTSIDE the lifecycle transaction. They come
  // from the route rather than the turf, so a racing delete can't 404 them
  // (a soft delete leaves the route in place), and folding the counts
  // aggregate's six queries into the transaction would hold the turf's
  // advisory lock across all of them — on the rail's hot path.
  private async withCounts(
    turf: RoutedTurf,
    organizationSlug: string,
  ): Promise<DoorKnockingTurf> {
    const counts = await this.counts.forRoutes(organizationSlug, [
      turf.route.id,
    ])
    return toResponse(turf, counts.get(turf.route.id))
  }
}
