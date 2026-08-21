import { Injectable } from '@nestjs/common'
import { StatsDTO } from '../schemas/people.schema'
import { DatabricksVoterService } from '../databricks/databricksVoter.service'
import type { ComputedDistrictStats } from '../databricks/databricksDistrictStatsSql.util'

@Injectable()
export class StatsService {
  constructor(private readonly databricks: DatabricksVoterService) {}

  // Computed on demand rather than read from the mirrored stats table, which
  // lags the voter data by days. A district with no voters resolves to null,
  // which is load-bearing: callers treat that as "no constituent data for this
  // office" and must not see it for any other reason.
  async findStats(dto: StatsDTO): Promise<ComputedDistrictStats | null> {
    return this.databricks.findStats(dto.districtId)
  }

  async findTotalConstituents(districtId: string): Promise<number | null> {
    return (
      (await this.databricks.findStats(districtId))?.totalConstituents ?? null
    )
  }

  async findTotalCounts(districtId: string) {
    const stats = await this.databricks.findStats(districtId)
    if (!stats) return null
    return {
      totalConstituents: stats.totalConstituents,
      totalConstituentsWithCellPhone: stats.totalConstituentsWithCellPhone,
    }
  }
}
