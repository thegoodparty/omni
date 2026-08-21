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
import { Prisma } from '../../generated/prisma'
import { lockTurf } from '../utils/turfLock.util'
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
  async list(organizationSlug: string): Promise<DoorKnockingTurf[]> {
    const turfs = await this.model.findMany({
      where: { voterFileFilter: { organizationSlug } },
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

  async findForOrganization(
    id: number,
    organizationSlug: string,
  ): Promise<TurfWithRouteId> {
    const turf = await this.model.findFirst({
      where: { id, voterFileFilter: { organizationSlug } },
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

  async delete(id: number, organizationSlug: string): Promise<void> {
    await this.client.$transaction(async (tx) => {
      await this.assertNotLocked(tx, id, organizationSlug)
      await tx.doorKnockingTurf.delete({
        where: { id, voterFileFilter: { organizationSlug } },
      })
    })
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
    await lockTurf(tx, id)
    const turf = await tx.doorKnockingTurf.findFirst({
      where: { id, voterFileFilter: { organizationSlug } },
      include: ROUTE_ID_INCLUDE,
    })
    if (!turf) {
      throw new NotFoundException('Turf not found')
    }
    if (turf.route) {
      throw new ConflictException(
        'This turf has already been knocked and its route is frozen — ' +
          'create a new turf to change the area',
      )
    }
  }
}
