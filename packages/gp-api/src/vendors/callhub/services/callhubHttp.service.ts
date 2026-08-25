import { HttpService } from '@nestjs/axios'
import { Injectable } from '@nestjs/common'
import { AxiosRequestConfig, AxiosResponse, isAxiosError } from 'axios'
import { firstValueFrom } from 'rxjs'
import { PinoLogger } from 'nestjs-pino'
import { CallhubBaseConfig } from '../config/callhubBaseConfig'

const MAX_RETRIES = 2
const RETRY_BASE_DELAY_MS = 1000

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

// Thin wrapper over the CallHub REST API: attaches the static token + base URL
// and retries the aggressive 429 throttling (and transient 5xx) with a short
// backoff. Callers do the Zod parsing and error mapping.
@Injectable()
export class CallhubHttpService extends CallhubBaseConfig {
  constructor(
    protected readonly logger: PinoLogger,
    private readonly httpService: HttpService,
  ) {
    super(logger)
  }

  private baseConfig(config?: AxiosRequestConfig): AxiosRequestConfig {
    return {
      ...config,
      baseURL: this.baseUrl,
      timeout: this.httpTimeoutMs,
      headers: {
        Authorization: `Token ${this.apiKey}`,
        ...config?.headers,
      },
    }
  }

  private isRetryable(error: unknown): boolean {
    if (!isAxiosError(error)) return false
    const status = error.response?.status
    return status === 429 || (status !== undefined && status >= 500)
  }

  private async withRetry<T>(
    send: () => Promise<AxiosResponse<T>>,
  ): Promise<AxiosResponse<T>> {
    let lastError: unknown
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await send()
      } catch (error) {
        lastError = error
        if (attempt === MAX_RETRIES || !this.isRetryable(error)) throw error
        await sleep(RETRY_BASE_DELAY_MS * (attempt + 1))
      }
    }
    throw lastError
  }

  async get<T>(path: string, config?: AxiosRequestConfig): Promise<T> {
    const res = await this.withRetry<T>(() =>
      firstValueFrom(this.httpService.get<T>(path, this.baseConfig(config))),
    )
    return res.data
  }

  async post<T>(
    path: string,
    body?: unknown,
    config?: AxiosRequestConfig,
  ): Promise<T> {
    const res = await this.withRetry<T>(() =>
      firstValueFrom(
        this.httpService.post<T>(path, body, this.baseConfig(config)),
      ),
    )
    return res.data
  }
}
