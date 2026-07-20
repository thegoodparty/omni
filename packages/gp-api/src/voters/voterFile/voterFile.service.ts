import { Injectable } from '@nestjs/common'
import { Campaign, OutreachType } from '../../generated/prisma'
import { CampaignTaskType } from 'src/campaigns/tasks/campaignTasks.types'
import { OrgDistrict } from 'src/organizations/organizations.types'
import { VoterDatabaseService } from '../services/voterDatabase.service'
import { GetVoterFileSchema } from './schemas/GetVoterFile.schema'
import { typeToQuery } from './util/voterFile.util'
import {
  CHANNEL_TO_TYPE_MAP,
  TASK_TO_TYPE_MAP,
  VoterFileType,
} from './voterFile.types'
import { PinoLogger } from 'nestjs-pino'

@Injectable()
export class VoterFileService {
  constructor(
    private readonly voterDb: VoterDatabaseService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(VoterFileService.name)
  }

  async getCsvOrCount(
    campaign: Campaign,
    {
      type,
      countOnly,
      customFilters,
      selectedColumns,
      limit,
    }: GetVoterFileSchema,
    district: OrgDistrict | null,
  ) {
    // Resolve type once at the beginning
    const resolvedType: VoterFileType =
      type === VoterFileType.custom && customFilters?.channel
        ? CHANNEL_TO_TYPE_MAP[customFilters.channel]
        : (Object.values(CampaignTaskType) as string[]).includes(type as string)
          ? // Union narrowing from dynamic input — runtime value comes from user request
            // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
            TASK_TO_TYPE_MAP[type as CampaignTaskType]
          : type === OutreachType.p2p
            ? VoterFileType.sms
            : // Union narrowing from dynamic input — runtime value comes from user request
              // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
              (type as VoterFileType)

    if (countOnly) {
      return this.getVoterCount(resolvedType, campaign, district, customFilters)
    }

    return this.getVoterCsv(
      resolvedType,
      campaign,
      district,
      customFilters,
      selectedColumns,
      limit,
    )
  }

  private async getVoterCount(
    resolvedType: VoterFileType,
    campaign: Campaign,
    district: OrgDistrict | null,
    customFilters?: GetVoterFileSchema['customFilters'],
  ): Promise<number> {
    // Try regular count first
    const countQuery = typeToQuery(
      this.logger,
      resolvedType,
      campaign,
      district,
      customFilters,
      true,
      false,
    )
    this.logger.debug({ countQuery }, 'Count Query:')

    const sqlResponse = await this.voterDb.query<{ count: string }>(countQuery)
    const countRow = sqlResponse.rows[0]
    if (!countRow) {
      throw new Error('Voter count query returned no rows')
    }
    const count = parseInt(String(countRow.count))

    // If count is 0, try with fix columns as fallback
    if (count === 0) {
      const countQueryWithFix = typeToQuery(
        this.logger,
        resolvedType,
        campaign,
        district,
        customFilters,
        true,
        true,
      )
      this.logger.debug({ countQueryWithFix }, 'Count Query with Fix Columns:')
      const sqlResponseWithFix = await this.voterDb.query<{ count: string }>(
        countQueryWithFix,
      )
      const countRowWithFix = sqlResponseWithFix.rows[0]
      if (!countRowWithFix) {
        throw new Error('Voter count query returned no rows')
      }
      return parseInt(String(countRowWithFix.count))
    }

    return count
  }

  private async getVoterCsv(
    resolvedType: VoterFileType,
    campaign: Campaign,
    district: OrgDistrict | null,
    customFilters?: GetVoterFileSchema['customFilters'],
    selectedColumns?: GetVoterFileSchema['selectedColumns'],
    limit?: GetVoterFileSchema['limit'],
  ) {
    // Check if we need to use fixColumns by doing a quick count check
    const countQuery = typeToQuery(
      this.logger,
      resolvedType,
      campaign,
      district,
      customFilters,
      true,
      false,
    )
    this.logger.debug({ countQuery }, 'Count Query:')

    const sqlResponse = await this.voterDb.query<{ count: string }>(countQuery)
    const countRow = sqlResponse.rows[0]
    if (!countRow) {
      throw new Error('Voter count query returned no rows')
    }
    const count = parseInt(String(countRow.count))
    const withFixColumns = count === 0

    this.logger.debug({ count }, 'count')

    // Generate CSV with appropriate fixColumns setting
    const query = typeToQuery(
      this.logger,
      resolvedType,
      campaign,
      district,
      customFilters,
      false,
      withFixColumns,
      selectedColumns,
      limit,
    )
    this.logger.debug({ query }, 'Constructed Query:')
    return this.voterDb.csvStream(query, 'voters', selectedColumns)
  }
}
