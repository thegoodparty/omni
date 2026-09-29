import { Injectable } from '@nestjs/common'
import {
  buildColumnSelect,
  createPrismaBase,
  MODELS,
} from 'src/prisma/util/prisma.util'
import { OfficeHolderFilterDto } from './officeHolders.schema'
import { Prisma } from '../generated/prisma'
import { coalesceKey, InFlightCoalescer } from '../shared/util/coalesce.util'

@Injectable()
export class OfficeHoldersService extends createPrismaBase(
  MODELS.OfficeHolder,
) {
  // This list is unpaginated by contract and a whole state is multi-megabyte:
  // `?state=PA&columns=personId,positionName,officeTitle` measured 6.9 MB and
  // 8.2 s in prod, holding one of the task's 25 Prisma connections for the
  // duration. Callers ask the same question up to fourteen times concurrently,
  // which emptied the pool and made unrelated reads fail with P2024. See
  // coalesce.util.ts for the measurements.
  private readonly listReads = new InFlightCoalescer()

  async getOfficeHolders(filterDto: OfficeHolderFilterDto) {
    return this.listReads.run(coalesceKey('officeholders', filterDto), () =>
      this.readOfficeHolders(filterDto),
    )
  }

  private async readOfficeHolders(filterDto: OfficeHolderFilterDto) {
    const {
      personId,
      positionId,
      geoId,
      state,
      isCurrent,
      includePosition,
      columns,
    } = filterDto

    const where: Prisma.OfficeHolderWhereInput = {
      ...(personId && { personId }),
      ...(positionId && { positionId }),
      ...(geoId && { geoId }),
      ...(state && { state }),
      ...(isCurrent !== undefined && { isCurrent }),
    }

    const relations = includePosition ? { Position: true } : {}

    if (columns) {
      const select = {
        ...(buildColumnSelect(columns) as Prisma.OfficeHolderSelect),
        ...relations,
      }
      return this.model.findMany({ where, select })
    }

    return this.model.findMany({ where, include: relations })
  }
}
