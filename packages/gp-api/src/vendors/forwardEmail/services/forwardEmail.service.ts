import { HttpService } from '@nestjs/axios'
import {
  BadGatewayException,
  BadRequestException,
  HttpStatus,
  Injectable,
} from '@nestjs/common'
import { AxiosResponse, isAxiosError } from 'axios'
import { lastValueFrom } from 'rxjs'
import { format } from '@redtea/format-axios-error'
import { isAxiosResponse } from '../../../shared/util/http.util'
import { Domain } from '../../../generated/prisma'
import {
  ForwardEmailAliasResponse,
  ForwardEmailDomainResponse,
} from '../forwardEmail.types'
import { PinoLogger } from 'nestjs-pino'
import { resolveEnvVar } from '../../../shared/env/env'

const FORWARDEMAIL_TIMEOUT_MS = 10000
enum ForwardEmailPlan {
  Free = 'free',
  EnhancedProtection = 'enhanced_protection',
  Team = 'team',
}

const FORWARDEMAIL_NOT_CONFIGURED_MESSAGE =
  'Campaign email forwarding is disabled: set FORWARDEMAIL_API_TOKEN and ' +
  'FORWARDEMAIL_BASE_URL'

type ForwardEmailConfig = {
  baseUrl: string
  // MUST have the trailing `:` for HTTP basic auth.
  tokenBase64: string
}

const resolveForwardEmailConfig = (): ForwardEmailConfig | null => {
  const apiToken = resolveEnvVar('FORWARDEMAIL_API_TOKEN')
  const baseUrl = resolveEnvVar('FORWARDEMAIL_BASE_URL')
  if (!apiToken.configured || !baseUrl.configured) {
    return null
  }
  return {
    baseUrl: baseUrl.value,
    tokenBase64: Buffer.from(`${apiToken.value}:`).toString('base64'),
  }
}

const forwardEmailConfig = resolveForwardEmailConfig()

@Injectable()
export class ForwardEmailService {
  private readonly httpTimeoutMs = FORWARDEMAIL_TIMEOUT_MS

  constructor(
    private readonly httpService: HttpService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ForwardEmailService.name)
    if (!forwardEmailConfig) {
      this.logger.warn(FORWARDEMAIL_NOT_CONFIGURED_MESSAGE)
    }
  }

  private requireConfig(): ForwardEmailConfig {
    if (!forwardEmailConfig) {
      throw new BadRequestException(FORWARDEMAIL_NOT_CONFIGURED_MESSAGE)
    }
    return forwardEmailConfig
  }

  private handleApiError(error: unknown): never {
    this.logger.error(
      { data: isAxiosResponse(error) ? format(error) : error },
      'Failed to communicate with Forward Email API',
    )
    throw new BadGatewayException(
      'Failed to communicate with Forward Email API',
    )
  }

  private getBaseHttpHeaders(): {
    headers: { Authorization: string }
    timeout: number
  } {
    return {
      headers: {
        Authorization: `Basic ${this.requireConfig().tokenBase64}`,
      },
      timeout: this.httpTimeoutMs,
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  private async paginateWithBackoff<T>(
    requester: (page: number, limit: number) => Promise<AxiosResponse<T[]>>,
  ): Promise<T[]> {
    const all: T[] = []
    const limit = 1000
    let page = 1
    let backoff = 250
    const maxBackoff = 8000
    const maxRetries = 5
    try {
      let hasMore = true
      while (hasMore) {
        let response: AxiosResponse<T[]> | null = null
        let attempt = 0
        let pending = true
        while (pending) {
          try {
            response = await requester(page, limit)
            pending = false
          } catch (e) {
            if (
              isAxiosError(e) &&
              e.response?.status === HttpStatus.CONFLICT &&
              attempt < maxRetries
            ) {
              await this.sleep(backoff)
              backoff = Math.min(backoff * 2, maxBackoff)
              attempt += 1
            } else {
              this.handleApiError(e)
            }
          }
        }
        const data = response!.data
        all.push(...data)
        const pageCount = Number(response!.headers['x-page-count'])
        const pageCurrent = Number(response!.headers['x-page-current'])
        const hasHeaderPagination =
          Number.isFinite(pageCount) &&
          Number.isFinite(pageCurrent) &&
          pageCurrent < pageCount
        hasMore = hasHeaderPagination || data.length === limit
        if (hasMore) {
          page += 1
          await this.sleep(backoff)
          backoff = Math.min(backoff * 2, maxBackoff)
        }
      }
      return all
    } catch (error) {
      this.handleApiError(error)
    }
  }

  private async listDomains(): Promise<ForwardEmailDomainResponse[]> {
    const { baseUrl } = this.requireConfig()
    const domains = await this.paginateWithBackoff<ForwardEmailDomainResponse>(
      (p, l) =>
        lastValueFrom(
          this.httpService.get<ForwardEmailDomainResponse[]>(
            `${baseUrl}/domains`,
            {
              ...this.getBaseHttpHeaders(),
              params: { page: p, limit: l, paginate: true, pagination: true },
            },
          ),
        ),
    )
    this.logger.debug(
      `Successfully retrieved (${domains?.length}) Forward Email domains`,
    )
    return domains
  }

  async getDomain(
    domainName: string,
  ): Promise<ForwardEmailDomainResponse | null> {
    const domains = await this.listDomains()
    return domains.find((d) => d.name === domainName) || null
  }

  async addDomain(domain: Domain): Promise<ForwardEmailDomainResponse> {
    const { baseUrl } = this.requireConfig()
    try {
      const response: AxiosResponse<ForwardEmailDomainResponse> =
        await lastValueFrom(
          this.httpService.post<ForwardEmailDomainResponse>(
            `${baseUrl}/domains`,
            { domain: domain.name, plan: ForwardEmailPlan.EnhancedProtection },
            this.getBaseHttpHeaders(),
          ),
        )
      const { data } = response
      this.logger.debug(data, 'Successfully created Forward Email domain')
      return data
    } catch (error) {
      this.handleApiError(error)
    }
  }

  async getCatchAllDomainAliases(
    domainName: string,
  ): Promise<ForwardEmailAliasResponse[]> {
    const { baseUrl } = this.requireConfig()
    const aliases = await this.paginateWithBackoff<ForwardEmailAliasResponse>(
      (p, l) =>
        lastValueFrom(
          this.httpService.get<ForwardEmailAliasResponse[]>(
            `${baseUrl}/domains/${encodeURIComponent(domainName)}/aliases`,
            {
              ...this.getBaseHttpHeaders(),
              params: {
                page: p,
                limit: l,
                paginate: true,
                pagination: true,
                name: '*',
              },
            },
          ),
        ),
    )
    this.logger.debug(
      { aliases },
      'Successfully retrieved Forward Email catch-all aliases',
    )
    return aliases
  }

  async createCatchAllAlias(
    forwardToEmail: string,
    forwardingDomainResponse: ForwardEmailDomainResponse,
  ): Promise<ForwardEmailAliasResponse> {
    const { baseUrl } = this.requireConfig()
    try {
      const response: AxiosResponse<ForwardEmailAliasResponse> =
        await lastValueFrom(
          this.httpService.post<ForwardEmailAliasResponse>(
            `${baseUrl}/domains/${encodeURIComponent(forwardingDomainResponse.id)}/aliases`,
            { name: '*', recipients: forwardToEmail },
            this.getBaseHttpHeaders(),
          ),
        )
      const { data } = response
      this.logger.debug(
        { data },
        'Successfully created Forward Email catch-all alias:',
      )
      return data
    } catch (error) {
      this.handleApiError(error)
    }
  }

  async updateDomainAlias(
    aliasId: string,
    forwardToEmail: string,
    forwardingDomainResponse: ForwardEmailDomainResponse,
  ): Promise<ForwardEmailAliasResponse> {
    const { baseUrl } = this.requireConfig()
    try {
      const response: AxiosResponse<ForwardEmailAliasResponse> =
        await lastValueFrom(
          this.httpService.put<ForwardEmailAliasResponse>(
            `${baseUrl}/domains/${encodeURIComponent(forwardingDomainResponse.id)}/aliases/${encodeURIComponent(aliasId)}`,
            { recipients: forwardToEmail },
            this.getBaseHttpHeaders(),
          ),
        )

      const { data } = response
      this.logger.debug(
        { data },
        'Successfully updated Forward Email catch-all alias:',
      )
      return data
    } catch (error) {
      this.handleApiError(error)
    }
  }
}
