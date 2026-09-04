import { Injectable } from '@nestjs/common'
import type { IdOverrides } from '@goodparty_org/contracts'
import {
  DatabricksVoterService,
  type RankPrecinctsResult,
} from '../databricks/databricksVoter.service'
import { VoterReadLogService } from '../databricks/voterReadLog.service'
import type { DbxDistrict } from '../databricks/databricksVoterSql.util'
import type { FilterData } from '../schemas/filters.schema'

// The recommended-lists reads, routed through the read log like every other
// voter read. One recommendation request issues several of these at once —
// a count per surviving variant, the district total, and a precinct ranking
// for door knocking — so an unmeasured path here would be the busiest new
// read in the feature and invisible to the latency tooling.
@Injectable()
export class VoterRecommendedListsService {
  constructor(
    private readonly databricks: DatabricksVoterService,
    private readonly readLog: VoterReadLogService,
  ) {}

  // Resolved once and handed back into every read below. Answered by
  // election-api rather than the warehouse, so it is not a voter read and
  // emits no line.
  resolveDistrict(districtId: string): Promise<DbxDistrict> {
    return this.databricks.resolveDistrict(districtId)
  }

  countForFilter(
    district: DbxDistrict,
    filters: FilterData,
    idOverrides?: IdOverrides,
  ): Promise<number> {
    return this.readLog.measure({
      op: 'rec-count',
      districtId: district.districtId,
      read: () =>
        this.databricks.countForFilter(district, filters, idOverrides),
    })
  }

  districtTotal(district: DbxDistrict): Promise<number> {
    return this.readLog.measure({
      op: 'rec-district-total',
      districtId: district.districtId,
      read: () => this.databricks.districtTotal(district),
    })
  }

  rankPrecincts(
    district: DbxDistrict,
    filters: FilterData,
    doorTarget: number,
    idOverrides?: IdOverrides,
  ): Promise<RankPrecinctsResult> {
    return this.readLog.measure({
      op: 'rec-rank-precincts',
      districtId: district.districtId,
      read: () =>
        this.databricks.rankPrecincts(
          district,
          filters,
          doorTarget,
          idOverrides,
        ),
    })
  }
}
