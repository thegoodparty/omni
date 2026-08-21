import { Inject, Injectable } from '@nestjs/common'
import { DistrictStats } from '../../generated/people-prisma'
import { createPeopleDbBase, PEOPLE_MODELS } from '../peopleDbBase.util'
import { StatsDTO } from '../schemas/people.schema'
import { DatabricksVoterService } from '../databricks/databricksVoter.service'
import { useDatabricksPeopleDb } from '../databricks/peopleDbx.config'

@Injectable()
export class StatsService extends createPeopleDbBase(
  PEOPLE_MODELS.DistrictStats,
) {
  // Property-injected, not constructor-injected: the Postgres path is still
  // the default, and this keeps this service's (absent) constructor and every
  // test that builds it untouched while the store is behind a flag.
  @Inject(DatabricksVoterService)
  private readonly databricks!: DatabricksVoterService

  async findStats(dto: StatsDTO): Promise<DistrictStats | null> {
    return useDatabricksPeopleDb()
      ? this.databricks.findStats(dto.districtId)
      : this.model.findUnique({ where: { districtId: dto.districtId } })
  }

  async findTotalConstituents(districtId: string): Promise<number | null> {
    if (useDatabricksPeopleDb()) {
      const stats = await this.databricks.findStats(districtId)
      return stats?.totalConstituents ?? null
    }
    const stats = await this.model.findUnique({
      select: { totalConstituents: true },
      where: { districtId },
    })
    return stats?.totalConstituents ?? null
  }

  async findTotalCounts(districtId: string) {
    if (useDatabricksPeopleDb()) {
      const stats = await this.databricks.findStats(districtId)
      return stats
        ? {
            totalConstituents: stats.totalConstituents,
            totalConstituentsWithCellPhone:
              stats.totalConstituentsWithCellPhone,
          }
        : null
    }
    return this.model.findUnique({
      select: {
        totalConstituents: true,
        totalConstituentsWithCellPhone: true,
      },
      where: { districtId },
    })
  }
}
