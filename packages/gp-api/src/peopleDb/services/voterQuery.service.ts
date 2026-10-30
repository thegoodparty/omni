import {
  PeopleAggregatesResponse,
  PeopleListDetailAggregatesResponse,
  PeopleOverlapCountResponse,
  PeoplePrecinctsResponse,
} from '@goodparty_org/contracts'
import {
  AggregatesDTO,
  GetPersonQueryDTO,
  ListPeopleDTO,
  OverlapCountDTO,
  SamplePeopleDTO,
} from '../schemas/people.schema'
import { Injectable } from '@nestjs/common'
import { DatabricksVoterService } from '../databricks/databricksVoter.service'
import { VoterReadLogService } from '../databricks/voterReadLog.service'
import type {
  DistrictCell,
  ReachChannelCell,
  ReachGroupCell,
  ReachHomes,
} from '../databricks/districtCensusSql.util'
import type {
  ContactUploadMatchCandidateRow,
  ContactUploadMatchInputRow,
} from '../databricks/contactUploadMatchSql.util'
import type { PeopleDataset } from './peopleDataset.service'

@Injectable()
export class VoterQueryService {
  constructor(
    private readonly databricks: DatabricksVoterService,
    private readonly readLog: VoterReadLogService,
  ) {}

  async findPerson(
    id: string,
    query: GetPersonQueryDTO,
    dataset: PeopleDataset,
  ) {
    return this.readLog.measure({
      op: 'voter-by-id',
      districtId: query.districtId,
      dataset,
      read: () => this.databricks.findPerson(id, query.districtId, dataset),
    })
  }

  // The picker's option list, enumerated unfiltered: the list is the
  // dimension's vocabulary, and one that narrowed with the other filters
  // could drop a precinct the user had already selected.
  async findPrecincts(
    districtId: string,
    dataset: PeopleDataset,
  ): Promise<PeoplePrecinctsResponse> {
    return this.readLog.measure({
      op: 'precincts',
      districtId,
      dataset,
      read: () => this.databricks.findPrecincts(districtId, dataset),
    })
  }

  async findPrecinctMembers(
    districtId: string,
    dataset: PeopleDataset,
    personIds: string[],
  ) {
    return this.readLog.measure({
      op: 'precinct-members',
      districtId,
      dataset,
      read: () =>
        this.databricks.findPrecinctMembers(districtId, dataset, personIds),
    })
  }

  async findReachPeople(
    districtId: string,
    dataset: PeopleDataset,
    args: {
      group: ReachGroupCell
      channel: ReachChannelCell
      excludeIds: readonly string[]
      limit: number
    },
  ): Promise<string[]> {
    return this.readLog.measure({
      op: 'reach-people',
      districtId,
      dataset,
      read: () => this.databricks.findReachPeople(districtId, dataset, args),
    })
  }

  async findReachHomes(
    districtId: string,
    dataset: PeopleDataset,
    args: { group: ReachGroupCell; excludeIds: readonly string[] },
  ): Promise<ReachHomes> {
    return this.readLog.measure({
      op: 'reach-homes',
      districtId,
      dataset,
      read: () => this.databricks.findReachHomes(districtId, dataset, args),
    })
  }

  async findPeople(dto: ListPeopleDTO, dataset: PeopleDataset) {
    return this.readLog.measure({
      op: 'list',
      districtId: dto.districtId,
      dataset,
      read: () => this.databricks.findPeople(dto, dataset),
    })
  }

  // Filtered aggregates (COUNT/AVG age/AVG income) for a list-detail page's
  // membership (ENG-10706) — distinct from StatsService.getStats, which only
  // serves the precomputed, unfiltered district stats row.
  async getAggregates(
    dto: AggregatesDTO,
    dataset: PeopleDataset,
  ): Promise<PeopleAggregatesResponse> {
    return this.readLog.measure({
      op: 'aggregates',
      districtId: dto.districtId,
      dataset,
      read: () => this.databricks.getAggregates(dto, dataset),
    })
  }

  // The audience counted by age band, gender, tract and race, for sizing
  // outreach so every sizable group can be heard from.
  async getPoolCells(
    dto: AggregatesDTO,
    dataset: PeopleDataset,
  ): Promise<DistrictCell[]> {
    return this.readLog.measure({
      op: 'pool-cells',
      districtId: dto.districtId,
      dataset,
      read: () => this.databricks.findPoolCells(dto, dataset),
    })
  }

  // Everything GET /v1/contacts/list-detail needs in one call: the same
  // demographics getAggregates returns, plus a reachable count per channel,
  // answered by a single statement with a COUNT_IF per channel.
  async getListDetailAggregates(
    dto: AggregatesDTO,
    dataset: PeopleDataset,
  ): Promise<PeopleListDetailAggregatesResponse> {
    return this.readLog.measure({
      op: 'list-detail-aggregates',
      districtId: dto.districtId,
      dataset,
      read: () => this.databricks.getListDetailAggregates(dto, dataset),
    })
  }

  // Saved-list overlap count (ENG-10840): how many of the current selection
  // also belong to at least one of the org's saved lists.
  async getOverlapCount(
    dto: OverlapCountDTO,
    dataset: PeopleDataset,
  ): Promise<PeopleOverlapCountResponse> {
    return this.readLog.measure({
      op: 'overlap',
      districtId: dto.districtId,
      dataset,
      read: () => this.databricks.getOverlapCount(dto, dataset),
    })
  }

  async samplePeople(dto: SamplePeopleDTO, dataset: PeopleDataset) {
    return this.readLog.measure({
      op: 'sample',
      districtId: dto.districtId,
      dataset,
      read: () => this.databricks.samplePeople(dto, dataset),
    })
  }

  // Import contacts matching: one statement per chunk of upload rows.
  async matchContactUploadRows(
    districtId: string,
    dataset: PeopleDataset,
    rows: ContactUploadMatchInputRow[],
  ): Promise<ContactUploadMatchCandidateRow[]> {
    return this.readLog.measure({
      op: 'contact-upload-match',
      districtId,
      dataset,
      read: () =>
        this.databricks.matchContactUploadRows(districtId, dataset, rows),
    })
  }
}
