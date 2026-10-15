import { Injectable } from '@nestjs/common'
import { StatsDTO } from '../schemas/people.schema'
import { DatabricksVoterService } from '../databricks/databricksVoter.service'
import { type ComputedDistrictStats } from '../databricks/databricksDistrictStatsSql.util'
import { VoterReadLogService } from '../databricks/voterReadLog.service'
import type { PeopleDataset } from './peopleDataset.service'

@Injectable()
export class StatsService {
  constructor(
    private readonly databricks: DatabricksVoterService,
    private readonly readLog: VoterReadLogService,
  ) {}

  async findStats(
    dto: StatsDTO,
    dataset: PeopleDataset,
  ): Promise<ComputedDistrictStats | null> {
    return this.readLog.measure({
      op: 'stats',
      districtId: dto.districtId,
      dataset,
      read: () => this.databricks.findStats(dto.districtId, dataset),
    })
  }
}
