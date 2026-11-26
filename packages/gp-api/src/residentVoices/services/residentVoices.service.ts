import { BadRequestException, Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import {
  RESIDENT_VOICES_MAX,
  type ResidentVoice,
  type ResidentVoicesResponse,
} from '@goodparty_org/contracts'
import type { Organization } from '@/generated/prisma'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import type { ResidentVoiceRow } from '@/peopleDb/databricks/residentVoicesSql.util'
import { ResidentVoiceQueryService } from '@/peopleDb/services/residentVoiceQuery.service'

const NO_VOICES: ResidentVoicesResponse = { voices: [], syntheticCount: 0 }

const DEFAULT_READ_BUDGET_MS = 4_000

const readBudgetMs = (): number =>
  Number(process.env.RESIDENT_VOICES_TIMEOUT_MS) || DEFAULT_READ_BUDGET_MS

// A 311 row is a call category, not something a person said.
const NOT_A_COMMENT_SOURCE = '311'
const IN_DISTRICT = 'verified_in_district'
const UNRANKED_TIER = 9

type PlacedRow = ResidentVoiceRow & { lat: number; lon: number }

const isPlaced = (row: ResidentVoiceRow): row is PlacedRow =>
  row.lat !== null &&
  row.lon !== null &&
  Math.abs(row.lat) <= 90 &&
  Math.abs(row.lon) <= 180

const byRank = (a: ResidentVoiceRow, b: ResidentVoiceRow): number =>
  (a.tier ?? UNRANKED_TIER) - (b.tier ?? UNRANKED_TIER) ||
  (a.displayRank ?? Infinity) - (b.displayRank ?? Infinity) ||
  a.id.localeCompare(b.id)

// Which comments the map shows: the real ones that can be placed inside the
// district first, best tier then display rank, then the district's
// synthesized ones to fill what is left.
export const pickResidentVoices = (
  rows: ResidentVoiceRow[],
): ResidentVoicesResponse => {
  const real = rows
    .filter(
      (row): row is PlacedRow =>
        !row.isSynthetic &&
        row.source !== NOT_A_COMMENT_SOURCE &&
        row.locationStatus === IN_DISTRICT &&
        isPlaced(row),
    )
    .sort(byRank)
    .slice(0, RESIDENT_VOICES_MAX)
  const synthetic = rows
    .filter((row): row is PlacedRow => row.isSynthetic && isPlaced(row))
    .sort(byRank)
    .slice(0, RESIDENT_VOICES_MAX - real.length)
  const voice = (row: PlacedRow): ResidentVoice => ({
    id: row.id,
    quote: row.quote,
    lat: row.lat,
    lon: row.lon,
    synthetic: row.isSynthetic,
  })
  return {
    voices: [...real, ...synthetic].map(voice),
    syntheticCount: synthetic.length,
  }
}

// The comments on the Serve welcome's map. The welcome moves past the map
// when this returns none, so every failure here is an empty answer and a
// warning, never an error: a missing table, no grant, no district, or a
// warehouse slower than the screen can wait for.
@Injectable()
export class ResidentVoicesService {
  constructor(
    private readonly organizations: OrganizationsService,
    private readonly query: ResidentVoiceQueryService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ResidentVoicesService.name)
  }

  async forOrganization(
    organization: Organization,
  ): Promise<ResidentVoicesResponse> {
    if (!organization.slug.startsWith('eo-')) {
      throw new BadRequestException(
        'Resident comments are not available for this organization',
      )
    }
    const organizationSlug = organization.slug
    const budgetMs = readBudgetMs()
    const abort = new AbortController()
    const read = this.read(organizationSlug, abort.signal).catch(
      (err: Error) => {
        // A read cut off below has already said why.
        if (!abort.signal.aborted) {
          this.logger.warn(
            { err, organizationSlug },
            'resident voices read failed; the map is skipped',
          )
        }
        return NO_VOICES
      },
    )
    let timer: NodeJS.Timeout | undefined
    const outOfTime = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), budgetMs)
    })
    const result = await Promise.race([read, outOfTime])
    clearTimeout(timer)
    if (result === null) {
      abort.abort()
      this.logger.warn(
        { organizationSlug, budgetMs },
        'resident voices read timed out; the map is skipped',
      )
      return NO_VOICES
    }
    return result
  }

  private async read(
    organizationSlug: string,
    signal: AbortSignal,
  ): Promise<ResidentVoicesResponse> {
    const { district } =
      await this.organizations.getDistrictAndLevelForOrgSlug(organizationSlug)
    if (!district) {
      this.logger.info(
        { organizationSlug },
        'resident voices: the office has no district; the map is skipped',
      )
      return NO_VOICES
    }
    const rows = await this.query.findForDistrict(district.id, signal)
    const picked = pickResidentVoices(rows)
    this.logger.info(
      {
        organizationSlug,
        districtId: district.id,
        rows: rows.length,
        voices: picked.voices.length,
        syntheticCount: picked.syntheticCount,
      },
      'resident voices read',
    )
    return picked
  }
}
