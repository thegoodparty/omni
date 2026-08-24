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
    return this.shadow.compare({
      op: 'stats',
      districtId: dto.districtId,
      primary: () =>
        this.model.findUnique({ where: { districtId: dto.districtId } }),
      shadow: () => this.shadow.databricks.findStats(dto.districtId),
      fingerprintPrimary: (result) => result?.totalConstituents ?? null,
      fingerprintShadow: (result) => result?.totalConstituents ?? null,
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
