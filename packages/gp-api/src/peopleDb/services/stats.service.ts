import { Injectable } from '@nestjs/common'
import { StatsDTO } from '../schemas/people.schema'
import { DatabricksVoterService } from '../databricks/databricksVoter.service'
import { type ComputedDistrictStats } from '../databricks/databricksDistrictStatsSql.util'
import {
  type AnswerCell,
  type CensusCompositionRows,
  type DistrictCells,
  type PersonAnswer,
  type WeightingInputs,
} from '../databricks/districtCensusSql.util'
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

  async findWeightingInputs(
    districtId: string,
    dataset: PeopleDataset,
    personIds: string[],
  ): Promise<WeightingInputs> {
    return this.readLog.measure({
      op: 'weighting-inputs',
      districtId,
      dataset,
      read: () =>
        this.databricks.findWeightingInputs(districtId, dataset, personIds),
    })
  }

  async findDistrictCells(
    districtId: string,
    dataset: PeopleDataset,
  ): Promise<DistrictCells> {
    return this.readLog.measure({
      op: 'district-cells',
      districtId,
      dataset,
      read: () => this.databricks.findDistrictCells(districtId, dataset),
    })
  }

  async findAnswerCells(
    districtId: string,
    dataset: PeopleDataset,
    answers: PersonAnswer[],
  ): Promise<AnswerCell[]> {
    return this.readLog.measure({
      op: 'answer-cells',
      districtId,
      dataset,
      read: () => this.databricks.findAnswerCells(districtId, dataset, answers),
    })
  }

  async findTractGridCells(
    districtId: string,
    dataset: PeopleDataset,
    tracts: string[],
    cellDegrees: number,
  ): Promise<Array<{ row: number; col: number }>> {
    return this.readLog.measure({
      op: 'tract-grid-cells',
      districtId,
      dataset,
      read: () =>
        this.databricks.findTractGridCells(
          districtId,
          dataset,
          tracts,
          cellDegrees,
        ),
    })
  }
}
