import { Injectable, NotFoundException } from '@nestjs/common'
import { District, Position, Prisma } from '../generated/prisma'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { PositionWithOptionalDistrict } from './positions.types'
import { extractFilingFee, FilingFeeResult } from './util/filingFee.util'
import { pickRelevantRace } from './util/pickRelevantRace.util'
import { pickNextUpcomingRace } from './util/pickNextUpcomingRace.util'

type PositionLookupOptions = {
  includeDistrict?: boolean
  includeFilingFee?: boolean
  electionDate?: string
}

type FindPositionWithOptionsParams = PositionLookupOptions & {
  where: Prisma.PositionWhereUniqueInput
  notFoundMessage: string
}

type PositionWithOptionalDistrictRow = {
  id: Position['id']
  brPositionId: Position['brPositionId']
  brDatabaseId: Position['brDatabaseId']
  state: Position['state']
  name: Position['name']
  level: Position['level']
  isWinIcp: Position['isWinIcp']
  isServeIcp: Position['isServeIcp']
  district?: {
    id: District['id']
    state: District['state']
    L2DistrictType: District['L2DistrictType']
    L2DistrictName: District['L2DistrictName']
  } | null
}

@Injectable()
export class PositionsService extends createPrismaBase(MODELS.Position) {
  constructor() {
    super()
  }

  async getPositionById(params: {
    id: string
    includeDistrict?: boolean
    includeFilingFee?: boolean
    electionDate?: string
  }): Promise<PositionWithOptionalDistrict> {
    const { id } = params
    return this.findPositionWithOptions({
      ...params,
      where: { id },
      notFoundMessage: `Position not found for id=${id}`,
    })
  }

  async getPositionByBallotReadyId(params: {
    brPositionId: string
    includeDistrict?: boolean
    includeFilingFee?: boolean
    electionDate?: string
  }): Promise<PositionWithOptionalDistrict> {
    const { brPositionId } = params
    return this.findPositionWithOptions({
      ...params,
      where: { brPositionId },
      notFoundMessage: `Position not found for brPositionId=${brPositionId}`,
    })
  }

  private async findPositionWithOptions(
    params: FindPositionWithOptionsParams,
  ): Promise<PositionWithOptionalDistrict> {
    const {
      where,
      notFoundMessage,
      includeDistrict,
      includeFilingFee,
      electionDate,
    } = params

    const baseSelect: Prisma.PositionSelect = {
      id: true,
      brPositionId: true,
      brDatabaseId: true,
      state: true,
      name: true,
      level: true,
      isWinIcp: true,
      isServeIcp: true,
    }

    const position: PositionWithOptionalDistrictRow | null = includeDistrict
      ? await this.model.findUnique({ where, include: { district: true } })
      : await this.model.findUnique({ where, select: baseSelect })
    if (!position) {
      throw new NotFoundException(notFoundMessage)
    }
    const filingFee = includeFilingFee
      ? await this.lookupFilingFee(position, electionDate)
      : undefined
    return this.shapePositionResponse(position, filingFee)
  }

  private shapePositionResponse(
    position: PositionWithOptionalDistrictRow,
    filingFee?: FilingFeeResult,
  ): PositionWithOptionalDistrict {
    const {
      id,
      brPositionId,
      brDatabaseId,
      state,
      level,
      name,
      district,
      isWinIcp,
      isServeIcp,
    } = position
    const filingFeeFields: Pick<
      PositionWithOptionalDistrict,
      'filingFee' | 'filingRequirementsText' | 'filingFeeExtractionSource'
    > = filingFee
      ? {
          filingFee: filingFee.filingFee,
          filingRequirementsText: filingFee.filingRequirementsText,
          filingFeeExtractionSource: filingFee.extractionSource,
        }
      : {}

    const base = {
      id,
      brPositionId,
      brDatabaseId,
      state,
      name,
      level,
      isWinIcp,
      isServeIcp,
      ...filingFeeFields,
    }
    if (!district) return base

    const {
      id: districtId,
      state: districtState,
      L2DistrictType,
      L2DistrictName,
    } = district
    return {
      ...base,
      district: {
        id: districtId,
        state: districtState,
        L2DistrictType,
        L2DistrictName,
      },
    }
  }

  // Resolves the position's next upcoming election date (yyyy-mm-dd), used by
  // gp-api to date a re-election campaign. Races are joined by the Race.positionId
  // FK, which BallotReady maintains per election schedule — so a multi-seat
  // "cohort" position (several Position rows sharing a name, one per schedule)
  // resolves only to its own races. electionDate is null when the position has
  // no future race, so the caller never dates a campaign to a past election.
  async getNextElectionForPosition(
    id: string,
  ): Promise<{ electionDate: string | null }> {
    const position = await this.model.findUnique({
      where: { id },
      select: { id: true },
    })
    if (!position) {
      throw new NotFoundException(`Position not found for id=${id}`)
    }

    const races = await this.client.race.findMany({
      where: { positionId: id },
      select: { electionDate: true, isPrimary: true, isRunoff: true },
    })
    const chosen = pickNextUpcomingRace(races, new Date())
    return {
      electionDate: chosen
        ? chosen.electionDate.toISOString().slice(0, 10)
        : null,
    }
  }

  /**
   * BallotReady stores filing fees on the Race row, not the Position. Races are
   * joined by the Race.positionId FK. One Position can have many Races (different
   * election dates, primary vs. general), so we pick the most relevant one:
   * matching electionDate exact > nearest future general > nearest future >
   * latest historical. Returns an empty result if no candidate race exists or
   * its filingRequirements yields nothing.
   */
  private async lookupFilingFee(
    position: PositionWithOptionalDistrictRow,
    electionDate?: string,
  ): Promise<FilingFeeResult> {
    const empty: FilingFeeResult = {
      filingFee: null,
      filingRequirementsText: null,
      extractionSource: null,
    }

    const races = await this.client.race.findMany({
      where: { positionId: position.id },
      select: {
        electionDate: true,
        isPrimary: true,
        isRunoff: true,
        filingRequirements: true,
        salary: true,
      },
    })
    if (races.length === 0) return empty

    const chosen = pickRelevantRace(races, electionDate)
    if (!chosen) return empty

    return extractFilingFee(chosen.filingRequirements, chosen.salary)
  }
}
