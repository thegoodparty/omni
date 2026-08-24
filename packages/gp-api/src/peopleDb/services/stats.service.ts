import { Inject, Injectable } from '@nestjs/common'
import { DistrictStats } from '../../generated/people-prisma'
import { createPeopleDbBase, PEOPLE_MODELS } from '../peopleDbBase.util'
import { StatsDTO } from '../schemas/people.schema'
import { ShadowReadService } from '../shadowRead.service'

@Injectable()
export class StatsService extends createPeopleDbBase(
  PEOPLE_MODELS.DistrictStats,
) {
  // Injected rather than constructor-arg because createPeopleDbBase owns the
  // constructor; property injection keeps the base's super() contract intact.
  @Inject(ShadowReadService)
  private readonly shadow!: ShadowReadService

  async findStats(dto: StatsDTO): Promise<DistrictStats | null> {
    if (!this.shadow.enabled) {
      return this.model.findUnique({ where: { districtId: dto.districtId } })
    }
    return this.shadow.compare({
      op: 'stats',
      districtId: dto.districtId,
      authoritative: () => this.shadow.databricks.findStats(dto.districtId),
      comparison: () =>
        this.model.findUnique({ where: { districtId: dto.districtId } }),
      fingerprintAuthoritative: (result) => result?.totalConstituents ?? null,
      fingerprintComparison: (result) => result?.totalConstituents ?? null,
    })
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
