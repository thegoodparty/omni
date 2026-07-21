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

const ROUTE_ID_INCLUDE = {
  route: { select: { id: true } },
} as const satisfies Prisma.DoorKnockingTurfInclude

type TurfWithRouteId = Prisma.DoorKnockingTurfGetPayload<{
  include: typeof ROUTE_ID_INCLUDE
}>

const toResponse = (turf: TurfWithRouteId): DoorKnockingTurf => ({
  id: turf.id,
  voterFileFilterId: turf.voterFileFilterId,
  name: turf.name,
  color: turf.color,
  geoPoly: turf.geoPoly,
  locked: turf.route !== null,
  createdAt: turf.createdAt,
  updatedAt: turf.updatedAt,
})

@Injectable()
export class DoorKnockingTurfService extends createPrismaBase(
  MODELS.DoorKnockingTurf,
) {
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

  async list(
    organizationSlug: string,
    voterFileFilterId?: number,
  ): Promise<DoorKnockingTurf[]> {
    const turfs = await this.model.findMany({
      where: {
        voterFileFilter: { organizationSlug },
        ...(voterFileFilterId ? { voterFileFilterId } : {}),
      },
      orderBy: { name: 'asc' },
      include: ROUTE_ID_INCLUDE,
    })
    return turfs.map(toResponse)
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

  async get(id: number, organizationSlug: string): Promise<DoorKnockingTurf> {
    return toResponse(await this.findForOrganization(id, organizationSlug))
  }

  async update(
    id: number,
    organizationSlug: string,
    input: UpdateDoorKnockingTurf,
  ): Promise<DoorKnockingTurf> {
    const turf = await this.client.$transaction(async (tx) => {
      await this.assertNotLocked(tx, id, organizationSlug)
      return tx.doorKnockingTurf.update({
        where: { id },
        data: input,
        include: ROUTE_ID_INCLUDE,
      })
    })
    return toResponse(turf)
  }

  async delete(id: number, organizationSlug: string): Promise<void> {
    await this.client.$transaction(async (tx) => {
      await this.assertNotLocked(tx, id, organizationSlug)
      await tx.doorKnockingTurf.delete({ where: { id } })
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
