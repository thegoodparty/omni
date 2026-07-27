import { Injectable } from '@nestjs/common'
import {
  buildColumnSelect,
  createPrismaBase,
  MODELS,
} from 'src/prisma/util/prisma.util'
import { OfficeHolderFilterDto } from './officeHolders.schema'
import { Prisma } from '../generated/prisma'

@Injectable()
export class OfficeHoldersService extends createPrismaBase(
  MODELS.OfficeHolder,
) {
  async getOfficeHolders(filterDto: OfficeHolderFilterDto) {
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
