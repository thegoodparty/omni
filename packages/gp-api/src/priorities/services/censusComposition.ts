import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import {
  MIN_RESPONDENTS_FOR_REPRESENTATION,
  type PriorityRepresentation,
} from '@goodparty_org/contracts'
import type { AcsCounts } from '@/peopleDb/databricks/districtCensusSql.util'
import type { PeopleDataset } from '@/peopleDb/services/peopleDataset.service'
import { StatsService } from '@/peopleDb/services/stats.service'
import { computeRepresentation } from '../util/representation.util'

export type CensusComposition =
  | {
      available: true
      district: AcsCounts
      // One entry per person placed in a block group, in any order.
      respondentBlockGroups: AcsCounts[]
    }
  | { available: false }

// Where district and block group demographics come from. Bound once in
// CensusCompositionModule, so a test can stand in for the warehouse.
export interface CensusCompositionSource {
  compose(input: {
    districtId: string
    dataset: PeopleDataset
    personIds: string[]
  }): Promise<CensusComposition>
  // The district's census population, or null when it has no row or the
  // warehouse could not be read.
  population(input: {
    districtId: string
    dataset: PeopleDataset
  }): Promise<number | null>
}

export const CENSUS_COMPOSITION_SOURCE = 'CensusCompositionSource'

// gp-data-platform's ACS marts in mart_gp_api: the district's row, and the
// block group each person lives in. A district with no row, or a warehouse
// failure, is unavailable: the page says so rather than failing or showing
// zeros.
@Injectable()
export class DistrictCensusComposition implements CensusCompositionSource {
  // A district's census figure does not change between reads, and the
  // priority page and every priority turn ask for it. Failures are not kept.
  private readonly populations = new Map<string, number | null>()

  constructor(
    private readonly stats: StatsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(DistrictCensusComposition.name)
  }

  async compose(input: {
    districtId: string
    dataset: PeopleDataset
    personIds: string[]
  }): Promise<CensusComposition> {
    try {
      const { district, respondentBlockGroups } =
        await this.stats.findCensusComposition(
          input.districtId,
          input.dataset,
          input.personIds,
        )
      return district
        ? { available: true, district, respondentBlockGroups }
        : { available: false }
    } catch (err) {
      this.logger.warn(
        { err, districtId: input.districtId },
        'census composition read failed; comparison unavailable',
      )
      return { available: false }
    }
  }

  async population(input: {
    districtId: string
    dataset: PeopleDataset
  }): Promise<number | null> {
    const key = `${input.dataset}:${input.districtId}`
    if (this.populations.has(key)) return this.populations.get(key) ?? null
    try {
      const value = await this.stats.findDistrictPopulation(
        input.districtId,
        input.dataset,
      )
      this.populations.set(key, value)
      return value
    } catch (err) {
      this.logger.warn(
        { err, districtId: input.districtId },
        'district population read failed; using the uncorrected answers needed',
      )
      return null
    }
  }
}

// Both pages that compare people with their district shape it the same way.
// Unavailable census is a comparison with no rows; too few people placed in
// a block group is no comparison at all, the same as too few answering.
export const representationFrom = (
  composition: CensusComposition,
  considered: number,
): PriorityRepresentation | null => {
  if (!composition.available) return { respondentCount: considered, groups: [] }
  const placed = composition.respondentBlockGroups
  if (placed.length < MIN_RESPONDENTS_FOR_REPRESENTATION) return null
  return {
    respondentCount: placed.length,
    groups: computeRepresentation(composition.district, placed),
  }
}
