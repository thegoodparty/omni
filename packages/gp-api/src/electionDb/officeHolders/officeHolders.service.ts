import { Injectable } from '@nestjs/common'
import {
  buildColumnSelect,
  createElectionDbBase,
  ELECTION_MODELS,
} from '@/electionDb/electionDbBase.util'
import {
  DEFAULT_OFFICE_HOLDER_PAGE_SIZE,
  OfficeHolderFilterDto,
} from './officeHolders.schema'
import { Prisma } from '@/generated/election-prisma'

@Injectable()
export class OfficeHoldersService extends createElectionDbBase(
  ELECTION_MODELS.OfficeHolder,
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
      // Defaulted here as well as in the DTO: the bound is a safety property,
      // so a hand-built filter must not be able to opt out of it.
      page = 1,
      pageSize = DEFAULT_OFFICE_HOLDER_PAGE_SIZE,
    } = filterDto

    const where: Prisma.OfficeHolderWhereInput = {
      ...(personId && { personId }),
      ...(positionId && { positionId }),
      ...(geoId && { geoId }),
      ...(state && { state }),
      ...(isCurrent !== undefined && { isCurrent }),
    }

    const relations = includePosition ? { Position: true } : {}

    // `id` because pagination needs a total order on a unique column.
    const paging = {
      orderBy: { id: Prisma.SortOrder.asc },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }

    if (columns) {
      const select = {
        ...(buildColumnSelect(columns) as Prisma.OfficeHolderSelect),
        ...relations,
      }
      return this.model.findMany({ where, select, ...paging })
    }

    return this.model.findMany({ where, include: relations, ...paging })
  }
}
