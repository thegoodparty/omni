import { Injectable } from '@nestjs/common'
import type { IdOverrides } from '@goodparty_org/contracts'
import {
  DatabricksVoterService,
  type PrecinctLandlinesResult,
  type RankPrecinctsResult,
} from '../databricks/databricksVoter.service'
import type { RecommendedListCountScope } from '../databricks/databricksRecommendedListsSql.util'
import { VoterReadLogService } from '../databricks/voterReadLog.service'
import type { DbxDistrict } from '../databricks/databricksVoterSql.util'
import type { FilterData } from '../schemas/filters.schema'
import { type AffinityColumn } from '../affinityColumns.const'
import type { PeopleDataset } from './peopleDataset.service'

// The recommended-lists reads, routed through the read log like every other
// voter read. One recommendation request sizes every one of its variants in a
// single count, plus a precinct ranking per variant for door knocking — so an
// unmeasured path here would be the busiest new read in the feature and
// invisible to the latency tooling.
@Injectable()
export class VoterRecommendedListsService {
  constructor(
    private readonly databricks: DatabricksVoterService,
    private readonly readLog: VoterReadLogService,
  ) {}

  // Resolved once and handed back into every read below. Answered by
  // the election database rather than the warehouse, so it is not a voter
  // read and emits no line.
  resolveDistrict(
    districtId: string,
    dataset: PeopleDataset,
  ): Promise<DbxDistrict> {
    return this.databricks.resolveDistrict(districtId, dataset)
  }

  // One read for every variant a recommendation request sizes. It used to be
  // one read per variant, which made the endpoint the busiest voter read in the
  // feature -- the reason this delegate exists -- and put a page view's whole
  // fan-out of district-wide aggregates on the warehouse at once.
  countsForFilters(
    district: DbxDistrict,
    variants: ReadonlyArray<RecommendedListCountScope>,
  ): Promise<number[]> {
    if (variants.length === 0) return Promise.resolve([])
    return this.readLog.measure({
      op: 'rec-counts',
      districtId: district.districtId,
      dataset: district.dataset,
      read: () => this.databricks.countsForFilters(district, variants),
    })
  }

  rankPrecincts(
    district: DbxDistrict,
    filters: FilterData,
    idOverrides?: IdOverrides,
    affinityColumn?: AffinityColumn,
  ): Promise<RankPrecinctsResult> {
    return this.readLog.measure({
      op: 'rec-rank-precincts',
      districtId: district.districtId,
      dataset: district.dataset,
      read: () =>
        this.databricks.rankPrecincts(
          district,
          filters,
          idOverrides,
          affinityColumn,
        ),
    })
  }

  precinctLandlines(district: DbxDistrict): Promise<PrecinctLandlinesResult> {
    return this.readLog.measure({
      op: 'rec-precinct-landlines',
      districtId: district.districtId,
      dataset: district.dataset,
      read: () => this.databricks.findPrecinctLandlines(district),
    })
  }
}
