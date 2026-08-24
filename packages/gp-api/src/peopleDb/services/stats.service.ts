import { Injectable } from '@nestjs/common'
import { DistrictStats } from '../../generated/people-prisma'
import { createPeopleDbBase, PEOPLE_MODELS } from '../peopleDbBase.util'
import { StatsDTO } from '../schemas/people.schema'

@Injectable()
export class StatsService extends createPeopleDbBase(
  PEOPLE_MODELS.DistrictStats,
) {
  async findStats(dto: StatsDTO): Promise<DistrictStats | null> {
    return this.model.findUnique({ where: { districtId: dto.districtId } })
  }

  async findTotalConstituents(districtId: string): Promise<number | null> {
    const stats = await this.model.findUnique({
      select: { totalConstituents: true },
      where: { districtId },
    })
    return stats?.totalConstituents ?? null
  }

  async findTotalCounts(districtId: string) {
    return this.model.findUnique({
      select: {
        totalConstituents: true,
        totalConstituentsWithCellPhone: true,
      },
      where: { districtId },
    })
  }
}
