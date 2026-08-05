import {
  NextElectionForPosition,
  NextElectionForPositionSchema,
  RaceFrequencyByBrHash,
  RaceFrequencyByBrHashSchema,
  RaceListItem,
  RaceListItemArraySchema,
  ZipCodesArraySchema,
} from '@goodparty_org/contracts'
import { HttpService } from '@nestjs/axios'
import {
  BadGatewayException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { isAxiosError } from 'axios'
import { PinoLogger } from 'nestjs-pino'
import { lastValueFrom } from 'rxjs'
import { serializeError } from 'serialize-error'
import { SlackService } from 'src/vendors/slack/services/slack.service'
import { SlackChannel } from 'src/vendors/slack/slackService.types'
import { ElectionApiTokenService } from '@/vendors/clerk/services/electionApiToken.service'
import { ElectionApiRoutes } from '../constants/elections.const'
import {
  BuildRaceTargetDetailsInput,
  CampaignStrategyContextResponse,
  District,
  DistrictNameItem,
  DistrictTypeItem,
  FilingFeeByBrHashResult,
  PositionWithOptionalDistrict,
  ProjectedTurnout,
  RaceTargetDetailsResult,
  RaceTargetMetrics,
  VoterIssue,
  VoterIssueLevel,
} from '../types/elections.types'

@Injectable()
export class ElectionsService {
  private static readonly BASE_URL = process.env.ELECTION_API_URL
  private static readonly VOTER_CONTACT_MULTIPLIER = 5
  private static readonly WIN_NUMBER_MULTIPLIER = 0.5
  private static readonly API_VERSION = 'v1'

  constructor(
    private readonly httpService: HttpService,
    private readonly slack: SlackService,
    private readonly logger: PinoLogger,
    private readonly tokenService: ElectionApiTokenService,
  ) {
    this.logger.setContext(ElectionsService.name)
    if (!ElectionsService.BASE_URL) {
      throw new Error(`Please set ELECTION_API_URL in your .env.
        Recommendation is to point it at dev if you are developing`)
    }
  }

  private async electionApiGet<Res, Q extends object>(
    path: string,
    query?: Q,
  ): Promise<Res | null> {
    const fullUrl = `${ElectionsService.BASE_URL}/${ElectionsService.API_VERSION}/${path}`
    const rawParams = (query ?? {}) as Record<
      string,
      string | number | boolean | string[] | null | undefined
    >
    // Object.keys/fromEntries returns string[] — TypeScript deliberately widens key types
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const filteredParams = Object.fromEntries(
      Object.entries(rawParams).filter(
        ([, v]) => v !== undefined && v !== null,
      ),
    ) as Record<string, string | number | boolean | string[]>
    this.logger.debug({ filteredParams }, `Election API GET ${path} params: `)
    try {
      const headers = await this.tokenService.authHeader()
      const { data, status } = (await lastValueFrom(
        this.httpService.get(fullUrl, {
          headers,
          params: query,
          paramsSerializer: (params) =>
            Object.entries(params)
              .filter(([, v]) => v !== undefined && v !== null)
              .flatMap(([k, v]) =>
                Array.isArray(v)
                  ? v.map((item) => `${k}=${encodeURIComponent(String(item))}`)
                  : [`${k}=${encodeURIComponent(String(v))}`],
              )
              .join('&'),
        }),
      )) as { data: Res; status: number }
      if (status >= 200 && status < 300) return data
      this.logger.warn(`Election API GET ${path}} responded ${status}`)
      return null
    } catch (error: unknown) {
      const baseMessage = `Election API GET ${path} failed`
      if (isAxiosError(error)) {
        // Axios error response is untyped — AxiosError.response.data is unknown
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        const data = error.response?.data as Record<string, unknown> | undefined
        const apiMessage =
          typeof data?.message === 'string' ? data.message : undefined
        const finalMessage = apiMessage
          ? `${baseMessage}: ${apiMessage}`
          : `${baseMessage}: ${error.message}`
        // A 404 from election-api is an expected "resource not found" outcome
        // (e.g. an org points at a position/district that no longer resolves) —
        // routine data variance, not an upstream fault. Surface it as a 404,
        // which the gp-api controller error alerts deliberately exclude, rather
        // than a 502 that pages on every failed district match. Log at warn so
        // telemetry still captures it. Genuine faults (5xx, network) stay 502.
        if (error.response?.status === 404) {
          this.logger.warn(finalMessage)
          throw new NotFoundException(apiMessage ?? finalMessage)
        }
        this.logger.error(finalMessage)
        throw new BadGatewayException(finalMessage)
      }
      const finalMessage = `${baseMessage}: ${String(error)}`
      this.logger.error(`Election API GET ${fullUrl} failed: ${String(error)}`)
      throw new BadGatewayException(finalMessage)
    }
  }

  private async electionApiPost<Res, Body extends object>(
    path: string,
    body: Body,
  ): Promise<Res | null> {
    const fullUrl = `${ElectionsService.BASE_URL}/${ElectionsService.API_VERSION}/${path}`
    this.logger.debug({ body }, `Election API POST ${path} body: `)
    try {
      const headers = await this.tokenService.authHeader()
      const { data, status } = (await lastValueFrom(
        this.httpService.post(fullUrl, body, { headers }),
      )) as { data: Res; status: number }
      if (status >= 200 && status < 300) return data
      this.logger.warn(`Election API POST ${path} responded ${status}`)
      return null
    } catch (error: unknown) {
      const baseMessage = `Election API POST ${path} failed`
      if (isAxiosError(error)) {
        // Axios error response is untyped — AxiosError.response.data is unknown
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        const data = error.response?.data as Record<string, unknown> | undefined
        const apiMessage =
          typeof data?.message === 'string' ? data.message : undefined
        const finalMessage = apiMessage
          ? `${baseMessage}: ${apiMessage}`
          : `${baseMessage}: ${error.message}`
        // See electionApiGet: a 404 is an expected not-found, not a fault — map
        // it to a 404 (excluded from error alerts) instead of a paging 502.
        if (error.response?.status === 404) {
          this.logger.warn(finalMessage)
          throw new NotFoundException(apiMessage ?? finalMessage)
        }
        this.logger.error(finalMessage)
        throw new BadGatewayException(finalMessage)
      }
      const finalMessage = `${baseMessage}: ${String(error)}`
      this.logger.error(`Election API POST ${fullUrl} failed: ${String(error)}`)
      throw new BadGatewayException(finalMessage)
    }
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

    const errorDetails = isAxiosError(error)
      ? JSON.stringify(
          {
            status: error.response?.status,
            // Axios error response is untyped — AxiosError.response.data is unknown
            // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
            data: error.response?.data as Record<
              string,
              string | number | boolean
            >,
          },
          null,
          2,
        )
      : error instanceof Error
        ? error.message
        : String(error)

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
  ) {
    return this.electionApiGet<
      PositionWithOptionalDistrict,
      { includeDistrict: boolean; includeTurnout: boolean }
    >(
      ElectionApiRoutes.positions.findByBrId.path + `/${ballotreadyPositionId}`,
      {
        includeDistrict: options?.includeDistrict ?? false,
        includeTurnout: false,
      },
    )
  }
  // Resolve election-api's internal Position id from a value that may be
  // either a BallotReady position id — how elected-office orgs historically
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
    options?: {
      includeDistrict?: boolean
      includeTurnout?: boolean
      electionDate?: string
    },
  ) {
    return this.electionApiGet<
      PositionWithOptionalDistrict,
      {
        includeDistrict: boolean
        includeTurnout: boolean
        electionDate?: string
      }
    >(`${ElectionApiRoutes.positions.findById.path}/${positionId}`, {
      includeDistrict: options?.includeDistrict ?? false,
      includeTurnout: options?.includeTurnout ?? false,
      electionDate: options?.electionDate,
    })
  }

  async getDistrict(id: string): Promise<District | null> {
    return this.electionApiGet<District, object>(`districts/${id}`, {})
  }

  async searchPositions(query: {
    zip?: string
    name?: string
    officeType?: string[]
    displayOfficeLevels?: string[]
    timeframe?: 'future' | 'past'
  }): Promise<RaceListItem[]> {
    const result = await this.electionApiGet<RaceListItem[], typeof query>(
      'positions/search',
      query,
    )
    return RaceListItemArraySchema.parse(result ?? [])
  }

  async getZipCodesByBrPositionId(brPositionId: string): Promise<string[]> {
    const result = await this.electionApiGet<string[], object>(
      `${ElectionApiRoutes.positions.zipCodes.path}/${brPositionId}/zip-codes`,
      {},
    )
    return ZipCodesArraySchema.parse(result ?? [])
  }

  async getVoterIssues(params: {
    districtId: string
    level?: VoterIssueLevel
  }): Promise<VoterIssue[] | null> {
    return this.electionApiGet<
      VoterIssue[],
      { districtId: string; level?: VoterIssueLevel }
    >('voter-issues', params)
  }

  async getDistrictId(
    state: string,
    l2DistrictType: string,
    l2DistrictName: string,
  ): Promise<string | null> {
    const districts = await this.electionApiGet<
      { id: string }[],
      {
        state: string
        L2DistrictType: string
        L2DistrictName: string
        districtColumns: string
      }
    >(ElectionApiRoutes.districts.list.path, {
      state,
      L2DistrictType: l2DistrictType,
      L2DistrictName: this.cleanDistrictName(l2DistrictName),
      districtColumns: 'id',
    })
    return districts?.[0]?.id ?? null
  }

  /**
   * Resolve the civics person id linked to a gp-api user via election-api's
   * `person.gp_api_user_id` filter. Powers gp-api's own backfill of
   * `User.person_id`: the data platform writes only the election-api column,
   * and gp-api pulls it here and writes its own DB — no data-team → gp-api
   * write. The gp-api User.id is numeric; election-api stores it as text, so
   * pass `String(gpApiUserId)`. Returns null on ANY failure (404 / 5xx /
   * network) so the caller degrades gracefully — the column is empty until the
   * data platform's ETL populates it, so this is a graceful no-op until then.
   */
  async getPersonIdByGpApiUserId(
    gpApiUserId: number | string,
  ): Promise<string | null> {
    try {
      const result = await this.electionApiGet<
        { id: string }[],
        { gpApiUserId: string; columns: string }
      >('persons', { gpApiUserId: String(gpApiUserId), columns: 'id' })
      return result?.[0]?.id ?? null
    } catch (error) {
      this.logger.warn(
        { error, gpApiUserId },
        'Election API GET persons?gpApiUserId failed',
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

    const path = ballotreadyPositionId
      ? `${ElectionApiRoutes.positions.findByBrId.path}/${ballotreadyPositionId}`
      : `${ElectionApiRoutes.positions.findById.path}/${positionId}`

    let positionWithDistrict: PositionWithOptionalDistrict | null = null
    try {
      positionWithDistrict = await this.electionApiGet<
        PositionWithOptionalDistrict,
        {
          electionDate: string | undefined
          includeDistrict: boolean
          includeTurnout: boolean
          includeFilingFee: boolean
        }
      >(path, {
        electionDate: electionDate ?? undefined,
        includeDistrict: true,
        includeTurnout,
        includeFilingFee: true,
      })

      const { district } = positionWithDistrict ?? {}
      if (!positionWithDistrict || !district) {
        throw new NotFoundException(
          'No position and/or associated district was found',
        )
      }

      const turnoutValue = district.projectedTurnout?.projectedTurnout
      const hasTurnout = includeTurnout && !!turnoutValue
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
        ...(hasTurnout
          ? this.calculateRaceTargetMetrics(turnoutValue)
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
      // A NotFoundException means election-api simply had no position/district
      // to match — routine data variance, not a system fault. We still log
      // every failure at info (with failureKind) so telemetry dashboards keep
      // their aggregate "no matched district" stats, but we only page botDev
      // for genuine errors so routine misses don't create alert noise.
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
        projectedTurnout: district?.projectedTurnout?.projectedTurnout,
      })
      if (!isNoMatch) {
        const message = this.buildSlackErrorMessage(
          'Election API error: getPositionMatchedRaceTargetDetails',
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
      const projectedTurnout = await this.electionApiGet<
        ProjectedTurnout,
        typeof query
      >(ElectionApiRoutes.projectedTurnout.find.path, query)

      if (!projectedTurnout) {
        throw new NotFoundException('No projectedTurnout found')
      }

      const { projectedTurnout: turnout } = projectedTurnout

      return this.calculateRaceTargetMetrics(turnout)
    } catch (error) {
      // A NotFoundException here (no projectedTurnout / election-api 404) is an
      // expected no-match, not a fault — skip the botDev page so routine misses
      // don't create alert noise. Genuine upstream errors still page. Either
      // way we return null so callers fall back gracefully.
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
          'Election API error: buildRaceTargetDetails',
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
   * (`Race.br_hash_id` in election-api). A direct race-hash lookup, used when
   * the caller holds the hash (the campaign stores it on `details.raceId`, set
   * by the office picker) rather than resolving via the position. Returns
   * `null` on any error — callers must fall back to the Position-based path or
   * accept no filing fee. We deliberately don't throw so this stays an opt-in
   * enrichment.
   */
  async fetchFilingFeeByRaceHash(
    brHashId: string,
  ): Promise<FilingFeeByBrHashResult | null> {
    if (!brHashId) return null
    const route = ElectionApiRoutes.races.filingFeeByBrHashId
    const path = `${route.path}/${encodeURIComponent(brHashId)}/${route.filingFeeSuffix}`
    try {
      return await this.electionApiGet<FilingFeeByBrHashResult, object>(
        path,
        {},
      )
    } catch (error) {
      this.logger.warn(
        { error, brHashId },
        'Election API GET races/by-br-hash-id filing-fee failed',
      )
      return null
    }
  }

  /**
   * Resolve a position's election cadence (`Race.frequency`) and election day
   * by BR race hash (the hash gp-api stores on `campaign.details.raceId`).
   * Feeds elected-office term derivation. Returns null on a missing hash or
   * any election-api failure — the caller leaves term fields unset rather
   * than blocking office creation on this enrichment.
   */
  async getElectionFrequencyByBrHashId(
    brHashId: string,
  ): Promise<RaceFrequencyByBrHash | null> {
    if (!brHashId) return null
    const route = ElectionApiRoutes.races.frequencyByBrHashId
    const path = `${route.path}/${encodeURIComponent(brHashId)}/${route.frequencySuffix}`
    try {
      const result = await this.electionApiGet<RaceFrequencyByBrHash, object>(
        path,
        {},
      )
      return result ? RaceFrequencyByBrHashSchema.parse(result) : null
    } catch (error) {
      this.logger.warn(
        { error, brHashId },
        'Election API GET races/by-br-hash-id frequency failed',
      )
      return null
    }
  }

  /**
   * Resolve a position's next upcoming election day from election-api by
   * internal position id. Used to date a re-election campaign at the position's
   * nearest future general election. Returns null on a missing id or any
   * election-api failure so the caller can fall back rather than block.
   */
  async getNextElectionForPosition(
    positionId: string,
  ): Promise<NextElectionForPosition | null> {
    if (!positionId) return null
    const route = ElectionApiRoutes.positions.nextElection
    const path = `${route.path}/${positionId}/${route.suffix}`
    try {
      const result = await this.electionApiGet<NextElectionForPosition, object>(
        path,
        {},
      )
      return result ? NextElectionForPositionSchema.parse(result) : null
    } catch (error) {
      this.logger.warn(
        { error, positionId },
        'Election API GET positions/:id/next-election failed',
      )
      return null
    }
  }

  /**
   * Fetch per-race civics context from election-api by BR race hash. The
   * upstream `/campaign-strategy-context` endpoint returns voter counts,
   * candidate roster, win-number variants, and election dates joined
   * through Race → Position → District. Returns null when the hash doesn't
   * resolve to a Race or election-api is unreachable — caller falls back
   * to whatever data it had before.
   */
  async fetchCampaignStrategyContext(
    brHashId: string,
  ): Promise<CampaignStrategyContextResponse | null> {
    if (!brHashId) return null
    try {
      return await this.electionApiPost<
        CampaignStrategyContextResponse,
        { brHashId: string }
      >(ElectionApiRoutes.campaignStrategyContext.path, { brHashId })
    } catch (error) {
      this.logger.warn(
        { error, brHashId },
        'Election API POST campaign-strategy-context failed',
      )
      return null
    }
  }

  async getValidDistrictTypes(
    state: string,
    electionYear: string | number,
    excludeInvalid = true,
  ) {
    const shouldExclude = excludeInvalid === true
    const query = {
      state,
      excludeInvalid: shouldExclude,
      ...(shouldExclude ? { electionYear } : {}),
    }
    return await this.electionApiGet<DistrictTypeItem[], typeof query>(
      ElectionApiRoutes.districts.types.path,
      query,
    )
  }

  async getValidDistrictNames(
    l2DistrictType: string,
    state?: string,
    electionYear?: string | number,
    excludeInvalid = true,
  ) {
    const shouldExclude = excludeInvalid === true
    const query = {
      L2DistrictType: l2DistrictType,
      state,
      excludeInvalid: shouldExclude,
      ...(shouldExclude ? { electionYear } : {}),
    }
    return await this.electionApiGet<DistrictNameItem[], typeof query>(
      ElectionApiRoutes.districts.names.path,
      query,
    )
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
