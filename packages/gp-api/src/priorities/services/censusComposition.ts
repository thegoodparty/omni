import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import {
  DISTRICT_GRID_CELL_DEGREES,
  MIN_RESPONDENTS_FOR_REPRESENTATION,
  type GeoJsonShape,
  type PriorityRepresentation,
} from '@goodparty_org/contracts'
import type {
  AcsCounts,
  RespondentCell,
  RespondentProfile,
} from '@/peopleDb/databricks/districtCensusSql.util'
import type { PeopleDataset } from '@/peopleDb/services/peopleDataset.service'
import { StatsService } from '@/peopleDb/services/stats.service'
import {
  unreachedTracts,
  weighToCensus,
  type WeightingCensus,
} from '../util/censusWeighting.util'
import { gridAreaShape } from '../util/gridArea.util'
import type { ReadWeighting } from '../util/priorityReadStatus.util'
import { computeRepresentation } from '../util/representation.util'

export type CensusComposition =
  | {
      available: true
      district: AcsCounts
      // One entry per person placed in a block group, in any order.
      respondentBlockGroups: AcsCounts[]
      // The same people in the same order, for weighting.
      respondentProfiles?: RespondentProfile[]
    }
  | { available: false }

// The answers weighted to the district's census mix: what the read status
// needs, and each respondent's weight for the shares the results page shows.
export interface CensusWeighting {
  read: ReadWeighting
  weightOf: (profile: RespondentProfile) => number
}

const profileKey = (profile: RespondentProfile): string =>
  [profile.ageBand, profile.gender, profile.tenure, profile.tract].join('|')

// Where district and block group demographics come from. Bound once in
// CensusCompositionModule, so a test can stand in for the warehouse.
export interface CensusCompositionSource {
  compose(input: {
    districtId: string
    dataset: PeopleDataset
    personIds: string[]
  }): Promise<CensusComposition>
  // Null when the district's census or the people could not be read.
  weighting(input: {
    districtId: string
    dataset: PeopleDataset
    personIds: string[]
  }): Promise<CensusWeighting | null>
  // The parts of the district these people have barely reached, as a
  // boundary a list can carry. Null when every part has been heard from.
  // Throws when the warehouse cannot be read: a list must not be saved as
  // though the area were known.
  unreachedArea(input: {
    districtId: string
    dataset: PeopleDataset
    personIds: string[]
  }): Promise<GeoJsonShape | null>
  // These people counted by age band, gender, tenure and tract, beside the
  // district's census, unweighted: what the civic panel steers its invites
  // by. Null when the district's census or the people could not be read.
  weightingInputs(input: {
    districtId: string
    dataset: PeopleDataset
    personIds: string[]
  }): Promise<{ cells: RespondentCell[]; census: WeightingCensus } | null>
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
  // priority page and every priority turn ask for it. Only a figure is kept:
  // a missing row may land later, and a failure is retried.
  private readonly populations = new Map<string, number>()

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
      const { district, respondentBlockGroups, respondentProfiles } =
        await this.stats.findCensusComposition(
          input.districtId,
          input.dataset,
          input.personIds,
        )
      return district
        ? {
            available: true,
            district,
            respondentBlockGroups,
            respondentProfiles,
          }
        : { available: false }
    } catch (err) {
      this.logger.warn(
        { err, districtId: input.districtId },
        'census composition read failed; comparison unavailable',
      )
      return { available: false }
    }
  }

  async weighting(input: {
    districtId: string
    dataset: PeopleDataset
    personIds: string[]
  }): Promise<CensusWeighting | null> {
    try {
      const { district, cells, tractAdults } =
        await this.stats.findWeightingInputs(
          input.districtId,
          input.dataset,
          input.personIds,
        )
      if (!district) return null
      const result = weighToCensus(cells, { district, tractAdults })
      const weights = new Map(
        cells.map((cell, index) => [
          profileKey(cell),
          result.weights[index] ?? 1,
        ]),
      )
      return {
        read: {
          effectiveSampleSize: result.effectiveSampleSize,
          largestGap: result.largestGap,
          gaps: result.gaps,
        },
        weightOf: (profile) => weights.get(profileKey(profile)) ?? 1,
      }
    } catch (err) {
      this.logger.warn(
        { err, districtId: input.districtId },
        'census weighting read failed; reading the count alone',
      )
      return null
    }
  }

  async weightingInputs(input: {
    districtId: string
    dataset: PeopleDataset
    personIds: string[]
  }): Promise<{ cells: RespondentCell[]; census: WeightingCensus } | null> {
    try {
      const { district, cells, tractAdults } =
        await this.stats.findWeightingInputs(
          input.districtId,
          input.dataset,
          input.personIds,
        )
      return district ? { cells, census: { district, tractAdults } } : null
    } catch (err) {
      this.logger.warn(
        { err, districtId: input.districtId },
        'weighting inputs read failed; no census comparison',
      )
      return null
    }
  }

  async unreachedArea(input: {
    districtId: string
    dataset: PeopleDataset
    personIds: string[]
  }): Promise<GeoJsonShape | null> {
    const { cells, tractAdults } = await this.stats.findWeightingInputs(
      input.districtId,
      input.dataset,
      input.personIds,
    )
    const tracts = unreachedTracts(cells, tractAdults)
    if (tracts.length === 0) return null
    return this.shapeOfTracts(input, tracts)
  }

  // Squares of the results grid wherever the tracts' people live, standing
  // in for the tracts' own outlines until the warehouse publishes them
  // (https://app.clickup.com/t/17tnw2b6k0u). Swap this one method then.
  private async shapeOfTracts(
    district: { districtId: string; dataset: PeopleDataset },
    tracts: string[],
  ): Promise<GeoJsonShape | null> {
    const squares = await this.stats.findTractGridCells(
      district.districtId,
      district.dataset,
      tracts,
      DISTRICT_GRID_CELL_DEGREES,
    )
    return gridAreaShape(squares, DISTRICT_GRID_CELL_DEGREES)
  }

  async population(input: {
    districtId: string
    dataset: PeopleDataset
  }): Promise<number | null> {
    const key = `${input.dataset}:${input.districtId}`
    const cached = this.populations.get(key)
    if (cached !== undefined) return cached
    try {
      const value = await this.stats.findDistrictPopulation(
        input.districtId,
        input.dataset,
      )
      if (value !== null) this.populations.set(key, value)
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
// With a weighting, each person counts by their weight, so the shares are
// the weighted answers' rather than the raw ones.
export const representationFrom = (
  composition: CensusComposition,
  considered: number,
  weighting: CensusWeighting | null = null,
): PriorityRepresentation | null => {
  if (!composition.available) return { respondentCount: considered, groups: [] }
  const placed = composition.respondentBlockGroups
  if (placed.length < MIN_RESPONDENTS_FOR_REPRESENTATION) return null
  const weights =
    weighting && composition.respondentProfiles
      ? composition.respondentProfiles.map(weighting.weightOf)
      : undefined
  return {
    respondentCount: placed.length,
    groups: computeRepresentation(composition.district, placed, weights),
  }
}
