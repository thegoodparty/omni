import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import {
  CreateDoorKnockingTurf,
  DoorKnockingTurf,
  UpdateDoorKnockingTurf,
} from '@goodparty_org/contracts'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { OutreachStatus, Prisma } from '../../generated/prisma'
import { lockTurf } from '../utils/turfLock.util'
import { activeTurfScope } from '../utils/turfScope.util'
import {
  DoorKnockingTurfCounts,
  DoorKnockingTurfCountsService,
} from './doorKnockingTurfCounts.service'

const ROUTE_ID_INCLUDE = {
  route: { select: { id: true } },
} as const satisfies Prisma.DoorKnockingTurfInclude

type TurfWithRouteId = Prisma.DoorKnockingTurfGetPayload<{
  include: typeof ROUTE_ID_INCLUDE
}>

// A turf that has been knocked, so its route — and therefore its counts and
// its outreach envelope — is reachable without a null check.
type KnockedTurf = TurfWithRouteId & {
  route: NonNullable<TurfWithRouteId['route']>
}

// The counts are null rather than 0 without a route, and that is the whole
// reason the contract makes them nullable: an unlocked list has nothing to
// count — no doors were ever frozen — while `0 of 0 logged` would read as a
// list someone walked and found empty.
const toResponse = (
  turf: TurfWithRouteId,
  counts?: DoorKnockingTurfCounts,
): DoorKnockingTurf => ({
  id: turf.id,
  voterFileFilterId: turf.voterFileFilterId,
  name: turf.name,
  color: turf.color,
  geoPoly: turf.geoPoly,
  locked: turf.route !== null,
  doorCount: counts?.doorCount ?? null,
  peopleCount: counts?.peopleCount ?? null,
  loggedCount: counts?.loggedCount ?? null,
  completedAt: turf.completedAt,
  archivedAt: turf.archivedAt,
  createdAt: turf.createdAt,
  updatedAt: turf.updatedAt,
})

@Injectable()
export class DoorKnockingTurfService extends createPrismaBase(
  MODELS.DoorKnockingTurf,
) {
  constructor(private readonly counts: DoorKnockingTurfCountsService) {
    super()
  }

  async create(
    organizationSlug: string,
    input: CreateDoorKnockingTurf,
  ): Promise<DoorKnockingTurf> {
    const filter = await this.client.voterFileFilter.findFirst({
      where: { id: input.voterFileFilterId, organizationSlug },
      select: { id: true },
    })
    if (!filter) {
      throw new NotFoundException('Voter file filter not found')
    }

    const turf = await this.model.create({
      data: input,
      include: ROUTE_ID_INCLUDE,
    })
    return toResponse(turf)
  }

  // The rail is the first screen a candidate lands on, so the counts ride the
  // list rather than costing a fetch per row: ONE batched aggregate across
  // every locked turf in the org, whatever the list count.
  //
  // Archived turfs are returned, carrying `archivedAt`, rather than filtered
  // out here. Two reasons: the client needs them to render an archived
  // section and a restore action at all, and `door-knocking/print/
  // walkListData.ts` resolves a turf's NAME by scanning this endpoint —
  // hiding a row would silently degrade its PDF to the "Walk list" fallback
  // while the sheet itself still printed fine. Soft-deleted turfs are a
  // different case and really are gone.
  async list(organizationSlug: string): Promise<DoorKnockingTurf[]> {
    const turfs = await this.model.findMany({
      where: activeTurfScope(organizationSlug),
      orderBy: { name: 'asc' },
      include: ROUTE_ID_INCLUDE,
    })
    const counts = await this.counts.forRoutes(
      organizationSlug,
      turfs.flatMap((turf) => (turf.route ? [turf.route.id] : [])),
    )
    return turfs.map((turf) =>
      toResponse(turf, turf.route ? counts.get(turf.route.id) : undefined),
    )
  }

  // A soft-deleted turf is indistinguishable from one that never existed, so
  // this 404s it like any other miss — same as a turf that isn't yours.
  async findForOrganization(
    id: number,
    organizationSlug: string,
  ): Promise<TurfWithRouteId> {
    const turf = await this.model.findFirst({
      where: { id, ...activeTurfScope(organizationSlug) },
      include: ROUTE_ID_INCLUDE,
    })
    if (!turf) {
      throw new NotFoundException('Turf not found')
    }
    return turf
  }

  // Same aggregate over one route. `create` and `update` skip it on purpose:
  // a turf being created has no route, and `update` runs `assertNotLocked`, so
  // both can only ever answer null.
  async get(id: number, organizationSlug: string): Promise<DoorKnockingTurf> {
    const turf = await this.findForOrganization(id, organizationSlug)
    if (!turf.route) return toResponse(turf)
    const counts = await this.counts.forRoutes(organizationSlug, [
      turf.route.id,
    ])
    return toResponse(turf, counts.get(turf.route.id))
  }

  async update(
    id: number,
    organizationSlug: string,
    input: UpdateDoorKnockingTurf,
  ): Promise<DoorKnockingTurf> {
    const turf = await this.client.$transaction(async (tx) => {
      await this.assertNotLocked(tx, id, organizationSlug)
      return tx.doorKnockingTurf.update({
        where: { id, voterFileFilter: { organizationSlug } },
        data: input,
        include: ROUTE_ID_INCLUDE,
      })
    })
    return toResponse(turf)
  }

  // Delete is offered at every stage now — the confirmation dialog is the
  // guard, not the lock. WHICH delete runs still depends on the lock, because
  // the two cases destroy very different amounts:
  //
  // An unlocked turf is a drawing. Nothing has been paid for or frozen, so the
  // row goes, and the cascade to its (nonexistent) route costs nothing.
  //
  // A locked turf has a route someone was billed for, frozen addresses, and
  // the name snapshots privacy deletion relies on. Hard-deleting it would
  // cascade all of that plus the Outreach envelope, silently removing the walk
  // from outreach history. So it is tombstoned instead: gone from every read
  // path, intact underneath. The knock interactions are the one thing that
  // survives either way — they hang off the organization, not this chain.
  async delete(id: number, organizationSlug: string): Promise<void> {
    await this.client.$transaction(async (tx) => {
      const turf = await this.lockAndFind(tx, id, organizationSlug)
      if (turf.route) {
        await tx.doorKnockingTurf.update({
          where: { id },
          data: { deletedAt: new Date() },
        })
        return
      }
      await tx.doorKnockingTurf.delete({ where: { id } })
    })
  }

  // "End knocking session". Idempotent by re-reading rather than blind-writing
  // so a double-tap can't move the timestamp — the card renders the completion
  // date, and having it drift forward on a stray click would misreport when
  // the walk actually finished.
  async complete(
    id: number,
    organizationSlug: string,
  ): Promise<DoorKnockingTurf> {
    const turf = await this.client.$transaction(async (tx) => {
      const locked = await this.lockAndFindKnocked(tx, id, organizationSlug)
      if (locked.completedAt) return locked

      // Mirror onto the envelope so the Win outreach history stops showing the
      // walk as in progress. updateMany, not update: a Serve org has no
      // campaign and therefore no envelope, and that is the normal case there,
      // not an error worth throwing over.
      await tx.outreach.updateMany({
        where: { doorKnockingRouteId: locked.route.id },
        data: { status: OutreachStatus.completed },
      })
      return this.stampKnocked(tx, locked, { completedAt: new Date() })
    })
    return this.withCounts(turf, organizationSlug)
  }

  // Archive is a shelf, not a state machine step: it requires a knocked list
  // but deliberately NOT a completed one. The design only offers it after
  // Done, but a candidate who abandons a half-walked list still needs it off
  // the rail, and refusing that would leave delete as the only way out.
  async setArchived(
    id: number,
    organizationSlug: string,
    archived: boolean,
  ): Promise<DoorKnockingTurf> {
    const turf = await this.client.$transaction(async (tx) => {
      const locked = await this.lockAndFindKnocked(tx, id, organizationSlug)
      // One timestamp for both rows. Reusing the turf's existing stamp is what
      // makes the guard below safe to skip the mirror past: an already-archived
      // list re-archived writes the date it already had, so neither row moves.
      const archivedAt = archived ? (locked.archivedAt ?? new Date()) : null

      // Mirror onto the envelope, for the same reason complete() mirrors
      // `status`: the turf is the object a candidate acts on — a Serve org has
      // one without a campaign — and the envelope is the campaign-reporting
      // projection the outreach history's Archive toggle filters on. Same
      // updateMany, so a missing envelope is a no-op rather than an error.
      //
      // Deliberately BEFORE the idempotence guard, and unconditional. Lists
      // archived before this mirror existed have an envelope that never
      // followed, and returning early on them would leave that drift
      // permanent — the one repair path a candidate has is pressing Archive
      // again. Writing the turf's own timestamp rather than `now` is what lets
      // this run every time without the guard's promise being broken.
      await tx.outreach.updateMany({
        where: { doorKnockingRouteId: locked.route.id },
        data: { archivedAt },
      })

      // Idempotent in the archiving direction for the same reason complete()
      // is: the card renders "archived since", and a double-tap or a client
      // retry must not walk that date forward. Un-archiving has nothing to
      // preserve — it writes null either way.
      if (archived && locked.archivedAt) return locked
      return this.stampKnocked(tx, locked, { archivedAt })
    })
    return this.withCounts(turf, organizationSlug)
  }

  // Locked is derived, not stored: the route row's existence IS the lock
  // (and the knock idempotency key), so there is no flag to clear or drift.
  // Runs under the turf advisory lock so a knock can't freeze the route
  // between this check and the caller's mutation — same-transaction only.
  private async assertNotLocked(
    tx: Prisma.TransactionClient,
    id: number,
    organizationSlug: string,
  ): Promise<void> {
    const turf = await this.lockAndFind(tx, id, organizationSlug)
    if (turf.route) {
      throw new ConflictException(
        'This turf has already been knocked and its route is frozen — ' +
          'create a new turf to change the area',
      )
    }
  }

  private async lockAndFind(
    tx: Prisma.TransactionClient,
    id: number,
    organizationSlug: string,
  ): Promise<TurfWithRouteId> {
    await lockTurf(tx, id)
    const turf = await tx.doorKnockingTurf.findFirst({
      where: { id, ...activeTurfScope(organizationSlug) },
      include: ROUTE_ID_INCLUDE,
    })
    if (!turf) {
      throw new NotFoundException('Turf not found')
    }
    return turf
  }

  // The mirror image of assertNotLocked, for the lifecycle transitions: they
  // only mean something once a route exists.
  private async lockAndFindKnocked(
    tx: Prisma.TransactionClient,
    id: number,
    organizationSlug: string,
  ): Promise<KnockedTurf> {
    const turf = await this.lockAndFind(tx, id, organizationSlug)
    if (!turf.route) {
      throw new ConflictException(
        'This list has not been knocked yet — there is no walk to update',
      )
    }
    return { ...turf, route: turf.route }
  }

  // Writes a lifecycle timestamp and returns the row as it stands INSIDE the
  // transaction, while the advisory lock still holds. Reading it afterwards
  // instead would race a concurrent delete: the turf would be tombstoned in
  // the gap, and the re-read — which filters `deletedAt: null` — would 404 an
  // operation that actually succeeded.
  private async stampKnocked(
    tx: Prisma.TransactionClient,
    locked: KnockedTurf,
    data: Prisma.DoorKnockingTurfUpdateInput,
  ): Promise<KnockedTurf> {
    const turf = await tx.doorKnockingTurf.update({
      where: { id: locked.id },
      data,
      include: ROUTE_ID_INCLUDE,
    })
    // The route is carried over from the locked read rather than re-derived
    // from this update, which types it as nullable. Nothing can drop a route
    // while the advisory lock is held, so this keeps the non-null guarantee
    // without asserting one.
    return { ...turf, route: locked.route }
  }

  // Counts are deliberately read OUTSIDE the lifecycle transaction. They come
  // from the route rather than the turf, so a racing delete can't 404 them
  // (a soft delete leaves the route in place), and folding the counts
  // aggregate's six queries into the transaction would hold the turf's
  // advisory lock across all of them — on the rail's hot path.
  private async withCounts(
    turf: KnockedTurf,
    organizationSlug: string,
  ): Promise<DoorKnockingTurf> {
    const counts = await this.counts.forRoutes(organizationSlug, [
      turf.route.id,
    ])
    return toResponse(turf, counts.get(turf.route.id))
  }
}
