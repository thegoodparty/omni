import { Injectable } from '@nestjs/common'
import { StatsDTO } from '../schemas/people.schema'
import { DatabricksVoterService } from '../databricks/databricksVoter.service'
import { type ComputedDistrictStats } from '../databricks/databricksDistrictStatsSql.util'
import {
  type AnswerCell,
  type DistrictCells,
  type PersonAnswer,
  type ThemeCell,
  type TractPlace,
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
    options: { countNewContacts?: boolean } = {},
  ): Promise<ComputedDistrictStats | null> {
    return this.readLog.measure({
      op: 'stats',
      districtId: dto.districtId,
      dataset,
      read: () => this.databricks.findStats(dto.districtId, dataset, options),
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

  async findThemeCells(
    districtId: string,
    dataset: PeopleDataset,
    themes: string[][],
  ): Promise<ThemeCell[]> {
    return this.readLog.measure({
      op: 'theme-cells',
      districtId,
      dataset,
      read: () => this.databricks.findThemeCells(districtId, dataset, themes),
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

  async findTractPlaces(
    districtId: string,
    dataset: PeopleDataset,
    tracts: string[],
  ): Promise<TractPlace[]> {
    return this.readLog.measure({
      op: 'tract-places',
      districtId,
      dataset,
      read: () => this.databricks.findTractPlaces(districtId, dataset, tracts),
    })
  }
}
