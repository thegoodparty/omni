import { Injectable, NotFoundException } from '@nestjs/common'
import { DistrictStats } from '../../generated/people-prisma'
import { createPeopleDbBase, PEOPLE_MODELS } from '../peopleDbBase.util'
import { StatsDTO } from '../schemas/people.schema'

@Injectable()
export class StatsService extends createPeopleDbBase(
  PEOPLE_MODELS.DistrictStats,
) {
  async getStats(dto: StatsDTO): Promise<DistrictStats> {
    const stats = await this.model.findUnique({
      where: { districtId: dto.districtId },
    })

    if (!stats) {
      throw new NotFoundException(
        `District stats not found for districtId=${dto.districtId}`,
      )
    }

    return stats
  }

  async findTotalConstituents(districtId: string): Promise<number | null> {
    const stats = await this.model.findUnique({
      select: { totalConstituents: true },
      where: { districtId },
    })
    return stats?.totalConstituents ?? null
  }

  async getTotalCounts(districtId: string) {
    const totalCounts = await this.model.findUnique({
      select: {
        totalConstituents: true,
        totalConstituentsWithCellPhone: true,
      },
      where: { districtId },
    })
    if (!totalCounts) {
      throw new NotFoundException(
        `District stats not found for districtId=${districtId}`,
      )
    }
    return totalCounts
  }
}
