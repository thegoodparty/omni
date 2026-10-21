import {
  NextElectionForPosition,
  NextElectionForPositionSchema,
  RaceFrequencyByBrHash,
  RaceFrequencyByBrHashSchema,
  RaceListItem,
  RaceListItemArraySchema,
  ZipCodesArraySchema,
} from '@goodparty_org/contracts'
import { Injectable, NotFoundException } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { serializeError } from 'serialize-error'
import { SlackService } from 'src/vendors/slack/services/slack.service'
import { SlackChannel } from 'src/vendors/slack/slackService.types'
import { CampaignStrategyContextService } from '@/electionDb/campaignStrategyContext/campaign-strategy-context.service'
import { DistrictsService } from '@/electionDb/districts/districts.service'
import { PersonsService } from '@/electionDb/persons/persons.service'
import { PositionsService } from '@/electionDb/positions/positions.service'
import { PositionWithOptionalDistrict as ElectionDbPosition } from '@/electionDb/positions/positions.types'
import { ProjectedTurnoutService } from '@/electionDb/projectedTurnout/projectedTurnout.service'
import { RacesService as ElectionDbRacesService } from '@/electionDb/races/races.service'
import { VoterIssuesService } from '@/electionDb/voterIssues/voterIssues.service'
import { ZipToPositionService } from '@/electionDb/zipToPosition/zipToPosition.service'
import { ElectionCode as PrismaElectionCode } from '@/generated/election-prisma'
import {
  BuildRaceTargetDetailsInput,
  CampaignStrategyContextResponse,
  District,
  DistrictNameItem,
  DistrictTypeItem,
  ElectionCode,
  FilingFeeByBrHashResult,
  PositionWithOptionalDistrict,
  RaceTargetDetailsResult,
  RaceTargetMetrics,
  VoterIssue,
  VoterIssueLevel,
} from '../types/elections.types'

// The columns `GET /districts/:id` served. The row carries createdAt/updatedAt
// too; selecting explicitly keeps them out of gp-api responses now that there
// is no wire shape narrowing them away.
const DISTRICT_SELECT = {
  id: true,
  state: true,
  L2DistrictType: true,
  L2DistrictName: true,
  registeredVoters: true,
  uniqueCellphones: true,
  uniqueLandlines: true,
}

// Widened lookup over the generated enum so an unrecognised code resolves to
// undefined rather than needing a cast.
const ELECTION_CODES: Record<string, PrismaElectionCode | undefined> =
  PrismaElectionCode

@Injectable()
export class ElectionsService {
  private static readonly VOTER_CONTACT_MULTIPLIER = 5
  private static readonly WIN_NUMBER_MULTIPLIER = 0.5
  // The voter-issues query schema defaulted `limit` to 10; the service itself
  // has no default, so the boundary's value lives here now.
  private static readonly VOTER_ISSUES_LIMIT = 10

  constructor(
    private readonly positions: PositionsService,
    private readonly districts: DistrictsService,
    private readonly zipToPosition: ZipToPositionService,
    private readonly voterIssues: VoterIssuesService,
    private readonly persons: PersonsService,
    private readonly projectedTurnout: ProjectedTurnoutService,
    private readonly races: ElectionDbRacesService,
    private readonly campaignStrategyContext: CampaignStrategyContextService,
    private readonly slack: SlackService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ElectionsService.name)
  }

  // The election schema types `Position.name` as nullable; the column is NOT
  // NULL, and gp-api consumers have always been handed a string.
  private toPositionResponse(
    position: ElectionDbPosition,
  ): PositionWithOptionalDistrict {
    return { ...position, name: position.name ?? '' }
  }

  private buildSlackErrorMessage(
    title: string,
    context: Record<string, string | number | boolean | null | undefined>,
    error: unknown,
  ): string {
    const contextLines = Object.entries(context)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => `- *${key}*: ${String(value)}`)
      .join('\n')

    const errorDetails = error instanceof Error ? error.message : String(error)

    return `*${title}*\n${contextLines}\n\n\`\`\`\n${errorDetails}\n\`\`\``
  }

  private calculateRaceTargetMetrics(
    projectedTurnout: number,
  ): Pick<
    RaceTargetMetrics,
    'winNumber' | 'voterContactGoal' | 'projectedTurnout'
  > {
    const winNumber =
      Math.ceil(projectedTurnout * ElectionsService.WIN_NUMBER_MULTIPLIER) + 1
    return {
      winNumber,
      voterContactGoal: winNumber * ElectionsService.VOTER_CONTACT_MULTIPLIER,
      projectedTurnout,
    }
  }

  async getPositionByBallotReadyId(
    ballotreadyPositionId: string,
    options?: { includeDistrict?: boolean },
  ): Promise<PositionWithOptionalDistrict | null> {
    const position = await this.positions.getPositionByBallotReadyId({
      brPositionId: ballotreadyPositionId,
      includeDistrict: options?.includeDistrict ?? false,
    })
    return this.toPositionResponse(position)
  }

  // Resolve the election database's internal Position id from a value that may
  // be either a BallotReady position id — how elected-office orgs historically
  // stored positionId (admin magic-link prefill) — or an already-internal id.
  // Falls back to the input when the BallotReady lookup finds nothing, so the
  // result is safe to hand to getNextElectionForPosition / getPositionById.
  async resolveInternalPositionId(positionId: string): Promise<string> {
    try {
      const position = await this.getPositionByBallotReadyId(positionId)
      return position?.id ?? positionId
    } catch (error) {
      this.logger.warn(
        { error, positionId },
        'BallotReady position lookup failed; treating id as internal',
      )
      return positionId
    }
  }

  async getPositionById(
    positionId: string,
    options?: { includeDistrict?: boolean },
  ): Promise<PositionWithOptionalDistrict | null> {
    const position = await this.positions.getPositionById({
      id: positionId,
      includeDistrict: options?.includeDistrict ?? false,
    })
    return this.toPositionResponse(position)
  }

  async getDistrict(id: string): Promise<District | null> {
    const district = await this.districts.findUnique({
      where: { id },
      select: DISTRICT_SELECT,
    })
    // The route this replaced 404'd on a miss, and callers that tolerate one
    // already catch. Returning null instead would silently widen them.
    if (!district) {
      throw new NotFoundException('District not found')
    }
    return district
  }

  async searchPositions(query: {
    zip?: string
    name?: string
    officeType?: string[]
    displayOfficeLevels?: string[]
    timeframe?: 'future' | 'past'
  }): Promise<RaceListItem[]> {
    const result = await this.zipToPosition.search(query)
    return RaceListItemArraySchema.parse(result)
  }

  async getZipCodesByBrPositionId(brPositionId: string): Promise<string[]> {
    const result =
      await this.zipToPosition.getZipCodesByBrPositionId(brPositionId)
    return ZipCodesArraySchema.parse(result)
  }

  async getVoterIssues(params: {
    districtId: string
    level?: VoterIssueLevel
  }): Promise<VoterIssue[] | null> {
    return this.voterIssues.getVoterIssues({
      districtId: params.districtId,
      limit: ElectionsService.VOTER_ISSUES_LIMIT,
      ...(params.level !== undefined && { level: params.level }),
    })
  }

  async getDistrictId(
    state: string,
    l2DistrictType: string,
    l2DistrictName: string,
  ): Promise<string | null> {
    const districts = await this.districts.getDistricts({
      state: state.toUpperCase(),
      L2DistrictType: l2DistrictType,
      L2DistrictName: this.cleanDistrictName(l2DistrictName),
      districtColumns: 'id',
      excludeInvalid: false,
    })
    const [first] = districts
    return first && 'id' in first && typeof first.id === 'string'
      ? first.id
      : null
  }

  /**
   * Resolve the civics person id linked to a gp-api user via the election
   * database's `person.gp_api_user_id`. Powers gp-api's own backfill of
   * `User.person_id`: the data platform writes only the election-side column,
   * and gp-api pulls it here and writes its own DB — no data-team → gp-api
   * write. The gp-api User.id is numeric; the person row stores it as text, so
   * pass `String(gpApiUserId)`. Returns null on ANY failure so the caller
   * degrades gracefully — the column is empty until the data platform's ETL
   * populates it, so this is a graceful no-op until then.
   */
  async getPersonIdByGpApiUserId(
    gpApiUserId: number | string,
  ): Promise<string | null> {
    try {
      const result = await this.persons.getPersons({
        gpApiUserId: String(gpApiUserId),
        columns: 'id',
        ids: undefined,
        includeOfficeHolders: false,
        includeCandidacies: false,
      })
      const [first] = result
      return first && 'id' in first && typeof first.id === 'string'
        ? first.id
        : null
    } catch (error) {
      this.logger.warn(
        { error, gpApiUserId },
        'Person lookup by gpApiUserId failed',
      )
      return null
    }
  }

  // Gold flow: match a district via BallotReady position ID.
  // Returns district data even when projected turnout is unavailable,
  // using sentinel values (-1) so callers can distinguish partial matches.
  async getPositionMatchedRaceTargetDetails(
    params: {
      electionDate?: string
      includeTurnout: boolean
      campaignId: number
      officeName: string | undefined
    } & (
      | { ballotreadyPositionId: string; positionId?: never }
      | { positionId: string; ballotreadyPositionId?: never }
    ),
  ) {
    const {
      ballotreadyPositionId,
      positionId,
      electionDate,
      includeTurnout,
      campaignId,
      officeName,
    } = params

    let positionWithDistrict: PositionWithOptionalDistrict | null = null
    try {
      const position = ballotreadyPositionId
        ? await this.positions.getPositionByBallotReadyId({
            brPositionId: ballotreadyPositionId,
            electionDate,
            includeDistrict: true,
            includeFilingFee: true,
          })
        : await this.positions.getPositionById({
            id: positionId ?? '',
            electionDate,
            includeDistrict: true,
            includeFilingFee: true,
          })
      positionWithDistrict = this.toPositionResponse(position)

      const { district } = positionWithDistrict
      if (!district) {
        throw new NotFoundException(
          'No position and/or associated district was found',
        )
      }

      // Turnout comes from the district-keyed lookup, the same one the
      // override-district path uses, rather than a relation embedded in the
      // position response. It returns null on any failure, so a miss degrades
      // to the sentinels below instead of throwing.
      const details =
        includeTurnout && electionDate
          ? await this.buildRaceTargetDetails({
              districtId: district.id,
              electionDate,
            })
          : null
      const turnoutValue = details?.projectedTurnout
      const hasTurnout = !!turnoutValue
      const { L2DistrictType: districtType, L2DistrictName: districtName } =
        district

      this.logger.info({
        event: 'DistrictMatch',
        matchType: 'gold',
        result: hasTurnout ? 'success' : 'partial',
        electionDate,
        campaignId,
        ballotreadyPositionId,
        positionId,
        officeName,
        districtType,
        districtName,
        projectedTurnout: turnoutValue,
      })
      return {
        district,
        ...(details && hasTurnout
          ? details
          : {
              // Sentinel values: turnout unavailable or not requested
              winNumber: -1,
              voterContactGoal: -1,
              projectedTurnout: -1,
            }),
        filingFee: positionWithDistrict.filingFee ?? null,
        filingRequirementsText:
          positionWithDistrict.filingRequirementsText ?? null,
      }
    } catch (error) {
      const { district } = positionWithDistrict ?? {}
      // A NotFoundException means there was simply no position/district to
      // match — routine data variance, not a system fault. We still log every
      // failure at info (with failureKind) so telemetry dashboards keep their
      // aggregate "no matched district" stats, but we only page botDev for
      // genuine errors so routine misses don't create alert noise.
      const isNoMatch = error instanceof NotFoundException
      this.logger.info({
        event: 'DistrictMatch',
        matchType: 'gold',
        result: 'failure',
        failureKind: isNoMatch ? 'no_match' : 'error',
        reason: error instanceof Error ? error.message : String(error),
        error: serializeError(error),
        electionDate,
        campaignId,
        ballotreadyPositionId,
        positionId,
        officeName,
        districtType: district?.L2DistrictType,
        districtName: district?.L2DistrictName,
      })
      if (!isNoMatch) {
        const message = this.buildSlackErrorMessage(
          'Election data error: getPositionMatchedRaceTargetDetails',
          {
            ballotreadyPositionId,
            positionId,
            electionDate,
            campaignId,
          },
          error,
        )
        await this.slack.formattedMessage({
          message,
          error,
          channel: SlackChannel.botDev,
        })
      }
      throw error
    }
  }

  async buildRaceTargetDetails(
    data: BuildRaceTargetDetailsInput,
  ): Promise<RaceTargetDetailsResult | null> {
    const query =
      'districtId' in data
        ? data
        : {
            ...data,
            L2DistrictName: this.cleanDistrictName(data.L2DistrictName),
          }
    try {
      const projectedTurnout = await this.projectedTurnout.getProjectedTurnout({
        ...('districtId' in query
          ? { districtId: query.districtId }
          : {
              state: query.state,
              L2DistrictType: query.L2DistrictType,
              L2DistrictName: query.L2DistrictName,
            }),
        // The query schema this replaced made electionDate required, and the
        // lookup only reads it to derive a year/code when neither is given.
        electionDate: query.electionDate ?? '',
        ...(query.electionYear !== undefined
          ? {
              electionYear: Number(query.electionYear),
              electionCode: query.electionCode
                ? ELECTION_CODES[query.electionCode]
                : undefined,
            }
          : {}),
      })

      if (!projectedTurnout) {
        throw new NotFoundException('No projectedTurnout found')
      }

      const { projectedTurnout: turnout } = projectedTurnout

      return this.calculateRaceTargetMetrics(turnout)
    } catch (error) {
      // A NotFoundException here (no projectedTurnout row) is an expected
      // no-match, not a fault — skip the botDev page so routine misses don't
      // create alert noise. Genuine errors still page. Either way we return
      // null so callers fall back gracefully.
      if (!(error instanceof NotFoundException)) {
        const context: Record<string, string | number | undefined> =
          'districtId' in data
            ? { districtId: data.districtId }
            : {
                state: data.state,
                L2DistrictType: data.L2DistrictType,
                L2DistrictName: data.L2DistrictName,
              }
        if ('electionDate' in data) context.electionDate = data.electionDate
        if ('electionCode' in data) {
          context.electionCode = data.electionCode
          context.electionYear = data.electionYear
        }
        const message = this.buildSlackErrorMessage(
          'Election data error: buildRaceTargetDetails',
          context,
          error,
        )
        await this.slack.formattedMessage({
          message,
          error,
          channel: SlackChannel.botDev,
        })
      }
      return null
    }
  }

  /**
   * Resolve a filing fee for a race identified by its BallotReady race hash
   * (`Race.br_hash_id`). A direct race-hash lookup, used when the caller holds
   * the hash (the campaign stores it on `details.raceId`, set by the office
   * picker) rather than resolving via the position. Returns `null` on any
   * error — callers must fall back to the Position-based path or accept no
   * filing fee. We deliberately don't throw so this stays an opt-in
   * enrichment.
   */
  async fetchFilingFeeByRaceHash(
    brHashId: string,
  ): Promise<FilingFeeByBrHashResult | null> {
    if (!brHashId) return null
    try {
      return await this.races.findFilingFeeByBrHashId(brHashId)
    } catch (error) {
      this.logger.warn(
        { error, brHashId },
        'Filing-fee lookup by BR race hash failed',
      )
      return null
    }
  }

  /**
   * Resolve a position's election cadence (`Race.frequency`) and election day
   * by BR race hash (the hash gp-api stores on `campaign.details.raceId`).
   * Feeds elected-office term derivation. Returns null on a missing hash or
   * any lookup failure — the caller leaves term fields unset rather than
   * blocking office creation on this enrichment.
   */
  async getElectionFrequencyByBrHashId(
    brHashId: string,
  ): Promise<RaceFrequencyByBrHash | null> {
    if (!brHashId) return null
    try {
      const result = await this.races.findFrequencyByBrHashId(brHashId)
      return RaceFrequencyByBrHashSchema.parse(result)
    } catch (error) {
      this.logger.warn(
        { error, brHashId },
        'Election-frequency lookup by BR race hash failed',
      )
      return null
    }
  }

  /**
   * Resolve a position's next upcoming election day by internal position id.
   * Used to date a re-election campaign at the position's nearest future
   * general election. Returns null on a missing id or any lookup failure so
   * the caller can fall back rather than block.
   */
  async getNextElectionForPosition(
    positionId: string,
  ): Promise<NextElectionForPosition | null> {
    if (!positionId) return null
    try {
      const result = await this.positions.getNextElectionForPosition(positionId)
      return NextElectionForPositionSchema.parse(result)
    } catch (error) {
      this.logger.warn(
        { error, positionId },
        'Next-election lookup for position failed',
      )
      return null
    }
  }

  /**
   * Fetch per-race civics context by BR race hash: voter counts, candidate
   * roster, win-number variants, and election dates joined through Race →
   * Position → District. Returns null when the hash doesn't resolve to a Race
   * — caller falls back to whatever data it had before.
   */
  async fetchCampaignStrategyContext(
    brHashId: string,
  ): Promise<CampaignStrategyContextResponse | null> {
    if (!brHashId) return null
    try {
      const { election_code: electionCode, ...rest } =
        await this.campaignStrategyContext.getCampaignStrategyContext({
          brHashId,
        })
      return {
        ...rest,
        election_code: electionCode ? ElectionCode[electionCode] : null,
      }
    } catch (error) {
      this.logger.warn(
        { error, brHashId },
        'Campaign strategy context lookup failed',
      )
      return null
    }
  }

  async getValidDistrictTypes(
    state: string,
    electionYear: string | number,
    excludeInvalid = true,
  ): Promise<DistrictTypeItem[] | null> {
    const shouldExclude = excludeInvalid === true
    const rows = await this.districts.getDistrictTypes({
      state: state.toUpperCase(),
      excludeInvalid: shouldExclude,
      ...(shouldExclude ? { electionYear: Number(electionYear) } : {}),
    })
    return rows.map((row) => ({
      id: String(row.id),
      L2DistrictType: String(row.L2DistrictType),
    }))
  }

  async getValidDistrictNames(
    l2DistrictType: string,
    state: string,
    electionYear: string | number,
    excludeInvalid = true,
  ): Promise<DistrictNameItem[] | null> {
    const shouldExclude = excludeInvalid === true
    const rows = await this.districts.getDistrictNames({
      L2DistrictType: l2DistrictType,
      state: state.toUpperCase(),
      excludeInvalid: shouldExclude,
      ...(shouldExclude ? { electionYear: Number(electionYear) } : {}),
    })
    return rows.map((row) => ({
      id: String(row.id),
      L2DistrictName: String(row.L2DistrictName),
    }))
  }

  cleanDistrictName(l2DistrictName: string) {
    const segments = l2DistrictName
      .split('##')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    if (segments.length === 0) return l2DistrictName
    let longest = segments[0] ?? l2DistrictName
    for (const segment of segments) {
      if (segment.length > longest.length) {
        longest = segment
      }
    }
    return longest
  }
}
