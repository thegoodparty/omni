import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { addMinutes, isAfter } from 'date-fns'
import {
  answersNeeded,
  DISTRICT_GRID_CELL_DEGREES,
  MIN_RESPONDENTS_FOR_REPRESENTATION,
  type GeoJsonShape,
  type PriorityRepresentation,
} from '@goodparty_org/contracts'
import type {
  AcsCounts,
  DistrictCell,
  DistrictCells,
  PersonAnswer,
  RespondentCell,
} from '@/peopleDb/databricks/districtCensusSql.util'
import type { PeopleDataset } from '@/peopleDb/services/peopleDataset.service'
import { StatsService } from '@/peopleDb/services/stats.service'
import {
  smallestMajorShare,
  type TargetedDimension,
} from '@/contacts/utils/civicPanelAllocation.util'
import {
  POOLED_VALUE,
  raceNameable,
  weightingTargets,
  type WeightingCensus,
} from '../util/censusWeighting.util'
import { gridAreaShape } from '../util/gridArea.util'
import type { MrpAnswerCell, MrpFrameCell } from '../util/mrp.util'
import { computeRepresentation } from '../util/representation.util'

export type CensusComposition =
  | {
      available: true
      district: AcsCounts
      // One entry per person placed in a block group, in any order.
      respondentBlockGroups: AcsCounts[]
    }
  | { available: false }

// What a priority's model reads: the district's people and the answers,
// in the same cells (age, gender, tract, race), race folded as the civic
// panel's steering folds it. Unknowns sit out their dimension.
export interface MrpInputs {
  frame: MrpFrameCell[]
  answers: MrpAnswerCell[]
  // Whether a race group may be named (raceNameable, over the answers).
  raceNameable: boolean
}

const DISTRICT_CELLS_CACHE_MINUTES = 15

// Race folds into 'other' wherever the census puts it under the share the
// comparison bars hide, and sits out when the census has no race figures.
const modelValues = (
  cell: DistrictCell,
  races: Record<string, number> | undefined,
): Record<string, string | null> => ({
  age: cell.ageBand,
  gender: cell.gender,
  tract: cell.tract,
  race:
    races && cell.race !== null
      ? races[cell.race] === undefined
        ? POOLED_VALUE
        : cell.race
      : null,
})

const knownValues = (
  values: Record<string, string | null>,
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(values).filter(
      (entry): entry is [string, string] => entry[1] !== null,
    ),
  )

// Where district and block group demographics come from. Bound once in
// CensusCompositionModule, so a test can stand in for the warehouse.
export interface CensusCompositionSource {
  compose(input: {
    districtId: string
    dataset: PeopleDataset
    personIds: string[]
  }): Promise<CensusComposition>
  // The district's people and these answers in the model's cells. Null
  // when the district's census or its people could not be read.
  mrpInputs(input: {
    districtId: string
    dataset: PeopleDataset
    answers: PersonAnswer[]
  }): Promise<MrpInputs | null>
  // These tracts as a boundary a list can carry. Null when no one lives in
  // them. Throws when the warehouse cannot be read: a list must not be saved
  // as though the area were known.
  areaOfTracts(input: {
    districtId: string
    dataset: PeopleDataset
    tracts: string[]
  }): Promise<GeoJsonShape | null>
  // These people counted by age band, gender, tenure and tract, beside the
  // district's census, unweighted: what the civic panel steers its invites
  // by. Null when the district's census or the people could not be read.
  weightingInputs(input: {
    districtId: string
    dataset: PeopleDataset
    personIds: string[]
  }): Promise<{ cells: RespondentCell[]; census: WeightingCensus } | null>
  // The answers a good read of the district needs: answersNeeded of its
  // smallest major group, from the cells the model reads. Null when the
  // district or its people could not be read.
  districtAnswersNeeded(input: {
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
  private readonly districtCells = new Map<
    string,
    { cells: Promise<DistrictCells>; expiresAt: Date }
  >()

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

  async mrpInputs(input: {
    districtId: string
    dataset: PeopleDataset
    answers: PersonAnswer[]
  }): Promise<MrpInputs | null> {
    try {
      const [{ district, cells }, answerCells] = await Promise.all([
        this.districtCellsOf(input),
        this.stats.findAnswerCells(
          input.districtId,
          input.dataset,
          input.answers,
        ),
      ])
      if (!district || cells.length === 0) return null
      const races = weightingTargets({ district, tractAdults: new Map() }).race
      return {
        frame: cells.map((cell) => ({
          count: cell.count,
          values: knownValues(modelValues(cell, races)),
        })),
        answers: answerCells.map((cell) => ({
          yes: cell.yes,
          answers: cell.count,
          values: modelValues(cell, races),
        })),
        raceNameable: raceNameable(answerCells),
      }
    } catch (err) {
      this.logger.warn(
        { err, districtId: input.districtId },
        'model inputs read failed; reading the count alone',
      )
      return null
    }
  }

  // Every priority in an office reads the same district, and a Chief of
  // Staff turn reads them all at once, so one read serves them: shared while
  // in flight and kept a while after. A failed read is dropped, so the next
  // one tries again.
  private districtCellsOf(input: {
    districtId: string
    dataset: PeopleDataset
  }): Promise<DistrictCells> {
    const key = `${input.dataset}:${input.districtId}`
    const now = new Date()
    const kept = this.districtCells.get(key)
    if (kept && isAfter(kept.expiresAt, now)) return kept.cells
    const cells = this.stats.findDistrictCells(input.districtId, input.dataset)
    this.districtCells.set(key, {
      cells,
      expiresAt: addMinutes(now, DISTRICT_CELLS_CACHE_MINUTES),
    })
    cells.catch(() => {
      if (this.districtCells.get(key)?.cells === cells) {
        this.districtCells.delete(key)
      }
    })
    return cells
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

  async areaOfTracts(input: {
    districtId: string
    dataset: PeopleDataset
    tracts: string[]
  }): Promise<GeoJsonShape | null> {
    if (input.tracts.length === 0) return null
    return this.shapeOfTracts(input, input.tracts)
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

  async districtAnswersNeeded(input: {
    districtId: string
    dataset: PeopleDataset
  }): Promise<number | null> {
    try {
      const { district, cells } = await this.districtCellsOf(input)
      if (!district || cells.length === 0) return null
      const races = weightingTargets({ district, tractAdults: new Map() }).race
      const frame = cells.map((cell) => ({
        count: cell.count,
        values: knownValues(modelValues(cell, races)),
      }))
      const dimensions: TargetedDimension[] = raceNameable(cells)
        ? ['age', 'gender', 'tract', 'race']
        : ['age', 'gender', 'tract']
      return answersNeeded(smallestMajorShare(frame, dimensions))
    } catch (err) {
      this.logger.warn(
        { err, districtId: input.districtId },
        'district cells read failed; sizing for the smallest major group',
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
