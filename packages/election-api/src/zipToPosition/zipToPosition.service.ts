import { Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '../generated/prisma'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { RaceListItem } from './zipToPosition.types'

// Use || (not ??) so empty, zero, or non-numeric env values all fall back
// to the default. DATA-1896 (commit f9b49dc) made this choice explicit;
// to disable the filter, set a tiny positive value, not 0.
const PCT_DISTRICTZIP_TO_ZIP_THRESHOLD =
  Number(process.env.PCT_DISTRICTZIP_TO_ZIP_THRESHOLD) || 0.005

type SearchParams = {
  zip?: string
  name?: string
  officeType?: string[]
  displayOfficeLevels?: string[]
  timeframe?: 'future' | 'past'
}

@Injectable()
export class ZipToPositionService extends createPrismaBase(
  MODELS.ZipToPosition,
) {
  constructor() {
    super()
  }

  // Resolve a zip (+ optional filters) to the actual races an onboarding user
  // can pick from. ZipToPosition maps zips → positions (Race carries no zip); we
  // use it only to gather the covered positionIds + their display metadata, then
  // read the real races off the Race table by the Race.positionId FK. That FK is
  // per election schedule, so multi-seat "cohort" positions each resolve to their
  // own races — the disambiguation the mart's electionDate alone can't provide
  // (it has no primary/general flag). Returns one item per race.
  async search(params: SearchParams): Promise<RaceListItem[]> {
    const where: Prisma.ZipToPositionWhereInput = {
      OR: [
        { pctDistrictzipToZip: null },
        { pctDistrictzipToZip: { gte: PCT_DISTRICTZIP_TO_ZIP_THRESHOLD } },
      ],
    }
    if (params.zip) where.zipCode = params.zip
    if (params.name) {
      where.name = { contains: params.name, mode: 'insensitive' }
    }
    if (params.officeType && params.officeType.length > 0) {
      where.officeType = { in: params.officeType }
    }
    if (params.displayOfficeLevels && params.displayOfficeLevels.length > 0) {
      where.displayOfficeLevel = { in: params.displayOfficeLevels }
    }

    const positions = await this.model.findMany({
      where,
      select: {
        positionId: true,
        name: true,
        displayOfficeLevel: true,
        state: true,
        district: true,
        position: { select: { brPositionId: true } },
      },
      distinct: ['positionId'],
    })
    if (positions.length === 0) return []

    const metaByPositionId = new Map(positions.map((p) => [p.positionId, p]))

    const now = new Date()
    const todayUtc = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    )
    const electionDate =
      params.timeframe === 'past' ? { lt: todayUtc } : { gte: todayUtc }

    const races = await this.client.race.findMany({
      where: { positionId: { in: [...metaByPositionId.keys()] }, electionDate },
      select: {
        id: true,
        positionId: true,
        electionDate: true,
        isPrimary: true,
        isRunoff: true,
        Place: { select: { name: true } },
      },
      orderBy: [{ electionDate: 'asc' }],
    })

    return races.flatMap((race) => {
      const meta = race.positionId
        ? metaByPositionId.get(race.positionId)
        : undefined
      if (!meta) return []
      return [
        {
          id: race.id,
          brPositionId: meta.position.brPositionId,
          position: {
            name: meta.name,
            level: meta.displayOfficeLevel,
            state: meta.state,
          },
          election: {
            electionDay: race.electionDate.toISOString().slice(0, 10),
          },
          isPrimary: race.isPrimary,
          isRunoff: race.isRunoff,
          city: race.Place?.name ?? null,
          district: meta.district === '' ? null : meta.district,
        },
      ]
    })
  }

  async getZipCodesByBrPositionId(brPositionId: string): Promise<string[]> {
    const position = await this.client.position.findUnique({
      where: { brPositionId },
      select: { id: true },
    })
    if (!position) {
      throw new NotFoundException(`Position ${brPositionId} not found`)
    }

    const today = new Date()
    today.setUTCHours(0, 0, 0, 0)

    const rows = await this.model.findMany({
      where: {
        positionId: position.id,
        electionDate: { gte: today },
        OR: [
          { pctDistrictzipToZip: null },
          { pctDistrictzipToZip: { gte: PCT_DISTRICTZIP_TO_ZIP_THRESHOLD } },
        ],
        zipCode: { not: null },
      },
      select: { zipCode: true },
      distinct: ['zipCode'],
    })

    return rows
      .map((r) => r.zipCode)
      .filter((z): z is string => z !== null)
      .sort()
  }
}
