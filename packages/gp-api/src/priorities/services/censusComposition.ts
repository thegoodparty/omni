import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { addMinutes, isAfter } from 'date-fns'
import {
  DISTRICT_GRID_CELL_DEGREES,
  type GeoJsonShape,
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
import { frameAnswersNeeded } from '@/contacts/utils/civicPanelAllocation.util'
import {
  POOLED_VALUE,
  raceNameable,
  weightingTargets,
  type WeightingCensus,
} from '../util/censusWeighting.util'
import { censusFrame } from '../util/censusFrame.util'
import { gridAreaShape } from '../util/gridArea.util'
import type { MrpAnswerCell, MrpFrameCell } from '../util/mrp.util'

// What a priority's model reads: the district's people and the answers,
// in the same cells (age, gender, tract, race), race folded as the civic
// panel's steering folds it. The frame's age, sex and tract margins are the
// census's adults (see censusFrame); race stays the voter file's. Unknowns
// sit out their dimension.
export interface MrpInputs {
  frame: MrpFrameCell[]
  answers: MrpAnswerCell[]
  // Whether a race group may be named (raceNameable, over the answers).
  raceNameable: boolean
}

// One cell of the model's values and how many of each theme's people sit
// in it, in the order the themes were given.
export interface ThemeCells {
  values: Record<string, string | null>
  themes: number[]
}

const DISTRICT_CELLS_CACHE_MINUTES = 15

// Race folds into 'other' wherever the census puts it under the share the
// comparison bars hide, and sits out when the census has no race figures.
const modelValues = (
  cell: Omit<DistrictCell, 'count'>,
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
  // The district's people and these answers in the model's cells. Null
  // when the district's census or its people could not be read.
  mrpInputs(input: {
    districtId: string
    dataset: PeopleDataset
    answers: PersonAnswer[]
  }): Promise<MrpInputs | null>
  // Each theme's people (one list per theme) in the model's cells, race
  // folded as the model folds it. Null when the district or its people
  // could not be read.
  themeCells(input: {
    districtId: string
    dataset: PeopleDataset
    themes: string[][]
  }): Promise<ThemeCells[] | null>
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
  // The answers a good read of the district needs: frameAnswersNeeded of
  // the frame the model reads, the same floor the read holds a priority to.
  // Null when the district or its people could not be read.
  districtAnswersNeeded(input: {
    districtId: string
    dataset: PeopleDataset
  }): Promise<number | null>
}

export const CENSUS_COMPOSITION_SOURCE = 'CensusCompositionSource'

// gp-data-platform's ACS marts in mart_gp_api and the district's voter
// file. A warehouse failure reads as unknown (null) rather than failing or
// showing zeros.
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

  async mrpInputs(input: {
    districtId: string
    dataset: PeopleDataset
    answers: PersonAnswer[]
  }): Promise<MrpInputs | null> {
    try {
      const [{ district, cells, tractAdults }, answerCells] = await Promise.all(
        [
          this.districtCellsOf(input),
          this.stats.findAnswerCells(
            input.districtId,
            input.dataset,
            input.answers,
          ),
        ],
      )
      if (!district || cells.length === 0) return null
      const { frame, races } = this.frameOf(input.districtId, {
        district,
        cells,
        tractAdults,
      })
      const known = new Map<string, Set<string>>()
      for (const cell of frame) {
        for (const [dimension, value] of Object.entries(cell.values)) {
          known.set(dimension, (known.get(dimension) ?? new Set()).add(value))
        }
      }
      // An answer in a tract the census placement left out of the frame sits
      // that dimension out, as the people in it do.
      const placed = (
        values: Record<string, string | null>,
      ): Record<string, string | null> => {
        const tract = values.tract ?? null
        return {
          ...values,
          tract:
            tract !== null && known.get('tract')?.has(tract) ? tract : null,
        }
      }
      return {
        frame,
        answers: answerCells.map((cell) => ({
          yes: cell.yes,
          answers: cell.count,
          values: placed(modelValues(cell, races)),
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

  async themeCells(input: {
    districtId: string
    dataset: PeopleDataset
    themes: string[][]
  }): Promise<ThemeCells[] | null> {
    try {
      const [{ district, cells, tractAdults }, themeCells] = await Promise.all([
        this.districtCellsOf(input),
        this.stats.findThemeCells(
          input.districtId,
          input.dataset,
          input.themes,
        ),
      ])
      if (!district || cells.length === 0) return null
      const { races } = this.frameOf(input.districtId, {
        district,
        cells,
        tractAdults,
      })
      return themeCells.map((cell) => ({
        values: modelValues(cell, races),
        themes: cell.themes,
      }))
    } catch (err) {
      this.logger.warn(
        { err, districtId: input.districtId },
        'theme cells read failed; themes go without a voices label',
      )
      return null
    }
  }

  // The one frame every read of the district shares: the model, the read
  // status's major groups and the sizing, so the groups named on screen are
  // the groups the model has. A dimension the census cannot give keeps the
  // voter file's counts, logged.
  private frameOf(
    districtId: string,
    input: {
      district: AcsCounts
      cells: DistrictCell[]
      tractAdults: Map<string, number>
    },
  ): {
    frame: MrpFrameCell[]
    races: Record<string, number> | undefined
  } {
    const { cells: raked, fromVoterFile } = censusFrame(input.cells, {
      district: input.district,
      tractAdults: input.tractAdults,
    })
    if (fromVoterFile.length > 0) {
      this.logger.warn(
        { districtId, dimensions: fromVoterFile },
        'census margin missing or suppressed; frame keeps the voter file counts',
      )
    }
    const races = weightingTargets({
      district: input.district,
      tractAdults: new Map(),
    }).race
    return {
      frame: raked.map((cell) => ({
        count: cell.count,
        values: knownValues(modelValues(cell, races)),
      })),
      races,
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
    const { base, overlayOrgSlug, overlayDistrictId } = input.dataset
    const key = `${base}:${overlayOrgSlug ?? ''}:${overlayDistrictId ?? ''}:${input.districtId}`
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
      const { district, cells, tractAdults } = await this.districtCellsOf(input)
      if (!district || cells.length === 0) return null
      const { frame } = this.frameOf(input.districtId, {
        district,
        cells,
        tractAdults,
      })
      return frameAnswersNeeded(frame)
    } catch (err) {
      this.logger.warn(
        { err, districtId: input.districtId },
        'district cells read failed; sizing for the smallest major group',
      )
      return null
    }
  }
}
