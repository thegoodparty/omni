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

@Injectable()
export class VoterQueryService {
  constructor(
    private readonly databricks: DatabricksVoterService,
    private readonly readLog: VoterReadLogService,
  ) {}

  async findPerson(id: string, query: GetPersonQueryDTO) {
    return this.readLog.measure({
      op: 'voter-by-id',
      districtId: query.districtId,
      read: () => this.databricks.findPerson(id, query.districtId),
    })
  }

  // The picker's option list, enumerated unfiltered: the list is the
  // dimension's vocabulary, and one that narrowed with the other filters
  // could drop a precinct the user had already selected.
  async findPrecincts(districtId: string): Promise<PeoplePrecinctsResponse> {
    return this.readLog.measure({
      op: 'precincts',
      districtId,
      read: () => this.databricks.findPrecincts(districtId),
    })
  }

  async findPeople(dto: ListPeopleDTO) {
    return this.readLog.measure({
      op: 'list',
      districtId: dto.districtId,
      read: () => this.databricks.findPeople(dto),
    })
  }

  // Filtered aggregates (COUNT/AVG age/AVG income) for a list-detail page's
  // membership (ENG-10706) — distinct from StatsService.getStats, which only
  // serves the precomputed, unfiltered district stats row.
  async getAggregates(dto: AggregatesDTO): Promise<PeopleAggregatesResponse> {
    return this.readLog.measure({
      op: 'aggregates',
      districtId: dto.districtId,
      read: () => this.databricks.getAggregates(dto),
    })
  }

  // Everything GET /v1/contacts/list-detail needs in one call: the same
  // demographics getAggregates returns, plus a reachable count per channel,
  // answered by a single statement with a COUNT_IF per channel.
  async getListDetailAggregates(
    dto: AggregatesDTO,
  ): Promise<PeopleListDetailAggregatesResponse> {
    return this.readLog.measure({
      op: 'list-detail-aggregates',
      districtId: dto.districtId,
      read: () => this.databricks.getListDetailAggregates(dto),
    })
  }

  // Saved-list overlap count (ENG-10840): how many of the current selection
  // also belong to at least one of the org's saved lists.
  async getOverlapCount(
    dto: OverlapCountDTO,
  ): Promise<PeopleOverlapCountResponse> {
    return this.readLog.measure({
      op: 'overlap',
      districtId: dto.districtId,
      read: () => this.databricks.getOverlapCount(dto),
    })
  }

  async samplePeople(dto: SamplePeopleDTO) {
    return this.readLog.measure({
      op: 'sample',
      districtId: dto.districtId,
      read: () => this.databricks.samplePeople(dto),
    })
  }
}
