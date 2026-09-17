import { Injectable } from '@nestjs/common'
import { StatsDTO } from '../schemas/people.schema'
import { DatabricksVoterService } from '../databricks/databricksVoter.service'
import { type ComputedDistrictStats } from '../databricks/databricksDistrictStatsSql.util'
import { VoterReadLogService } from '../databricks/voterReadLog.service'

@Injectable()
export class StatsService {
  constructor(
    private readonly databricks: DatabricksVoterService,
    private readonly readLog: VoterReadLogService,
  ) {}

  async findStats(dto: StatsDTO): Promise<ComputedDistrictStats | null> {
    return this.readLog.measure({
      op: 'stats',
      districtId: dto.districtId,
      read: () => this.databricks.findStats(dto.districtId),
    })
  }
}
