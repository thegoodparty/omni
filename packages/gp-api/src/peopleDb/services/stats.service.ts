import { Injectable } from '@nestjs/common'
import { StatsDTO } from '../schemas/people.schema'
import { DatabricksVoterService } from '../databricks/databricksVoter.service'
import { type ComputedDistrictStats } from '../databricks/databricksDistrictStatsSql.util'
import { type CensusCompositionRows } from '../databricks/districtCensusSql.util'
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

  async findDistrictPopulation(
    districtId: string,
    dataset: PeopleDataset,
  ): Promise<number | null> {
    return this.readLog.measure({
      op: 'district-population',
      districtId,
      dataset,
      read: () => this.databricks.findDistrictPopulation(districtId, dataset),
    })
  }

  async findCensusComposition(
    districtId: string,
    dataset: PeopleDataset,
    personIds: string[],
  ): Promise<CensusCompositionRows> {
    return this.readLog.measure({
      op: 'census-composition',
      districtId,
      dataset,
      read: () =>
        this.databricks.findCensusComposition(districtId, dataset, personIds),
    })
  }
}
