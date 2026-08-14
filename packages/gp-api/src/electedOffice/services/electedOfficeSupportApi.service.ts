import { HttpService } from '@nestjs/axios'
import { BadGatewayException, Injectable } from '@nestjs/common'
import { isAxiosError } from 'axios'
import { PinoLogger } from 'nestjs-pino'
import { lastValueFrom } from 'rxjs'
import {
  ElectedOfficeSupport,
  ElectedOfficeSupportSchema,
} from '@goodparty_org/contracts'
import { ElectionApiTokenService } from '@/vendors/clerk/services/electionApiToken.service'

@Injectable()
export class ElectedOfficeSupportApiService {
  private static readonly PATH = 'v1/elected-office-support'
  private readonly baseUrl: string

  constructor(
    private readonly httpService: HttpService,
    private readonly logger: PinoLogger,
    private readonly tokenService: ElectionApiTokenService,
  ) {
    this.logger.setContext(ElectedOfficeSupportApiService.name)
    const baseUrl = process.env.ELECTION_API_URL
    if (!baseUrl) {
      throw new Error('ELECTION_API_URL is not set')
    }
    this.baseUrl = baseUrl
  }

  // Reads one office's constituent-support row from election-api. Returns null
  // when election-api has no row (the table is empty until the data team's ETL
  // populates it), so callers render a "no estimate yet" state instead of
  // failing. Network/shape failures are surfaced as 502 (BadGateway).
  async getByElectedOfficeId(
    electedOfficeId: string,
  ): Promise<ElectedOfficeSupport | null> {
    const url = `${this.baseUrl}/${ElectedOfficeSupportApiService.PATH}`
    try {
      const headers = await this.tokenService.authHeader()
      const { data } = await lastValueFrom(
        this.httpService.get<unknown>(url, {
          params: { electedOfficeId },
          headers,
        }),
      )
      const parsed = ElectedOfficeSupportSchema.safeParse(data)
      if (!parsed.success) {
        this.logger.error(
          { issues: parsed.error.issues },
          'election-api elected-office-support failed schema validation',
        )
        throw new BadGatewayException(
          'election-api returned an unexpected response shape',
        )
      }
      return parsed.data
    } catch (error) {
      if (error instanceof BadGatewayException) throw error
      const status = isAxiosError(error) ? error.response?.status : undefined
      if (status === 404) return null
      this.logger.error(
        {
          electedOfficeId,
          status,
          message: error instanceof Error ? error.message : String(error),
        },
        'election-api elected-office-support request failed',
      )
      throw new BadGatewayException('election-api request failed')
    }
  }
}
