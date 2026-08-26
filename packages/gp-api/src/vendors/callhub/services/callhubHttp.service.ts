import { HttpService } from '@nestjs/axios'
import { Injectable } from '@nestjs/common'
import { AxiosRequestConfig, AxiosResponse, isAxiosError } from 'axios'
import FormData from 'form-data'
import { firstValueFrom } from 'rxjs'
import { PinoLogger } from 'nestjs-pino'
import { CallhubBaseConfig } from '../config/callhubBaseConfig'

const MAX_RETRIES = 2
const RETRY_BASE_DELAY_MS = 1000
// Plain numbers, not HttpStatus: axios reports status as a number, and
// comparing that to the HttpStatus enum trips no-unsafe-enum-comparison.
const HTTP_TOO_MANY_REQUESTS = 429
const HTTP_SERVER_ERROR_MIN = 500

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

  // A 429 (throttle) is rejected before the request is processed, so retrying
  // is always safe. A 5xx may have already executed the request, so it is only
  // retried for idempotent GETs — retrying a POST (rent, import, upload)
  // could double a billable side effect.
  private isRetryable(error: unknown, retryServerErrors: boolean): boolean {
    if (!isAxiosError(error)) return false
    const status = error.response?.status
    if (status === HTTP_TOO_MANY_REQUESTS) return true
    return (
      retryServerErrors &&
      status !== undefined &&
      status >= HTTP_SERVER_ERROR_MIN
    )
  }

  private async withRetry<T>(
    send: () => Promise<AxiosResponse<T>>,
    opts: { retryServerErrors: boolean; allowRetry: boolean },
  ): Promise<AxiosResponse<T>> {
    let lastError: unknown
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await send()
      } catch (error) {
        lastError = error
        const canRetry =
          opts.allowRetry && this.isRetryable(error, opts.retryServerErrors)
        if (attempt === MAX_RETRIES || !canRetry) throw error
        await sleep(RETRY_BASE_DELAY_MS * (attempt + 1))
      }
    }
    throw lastError
  }

  async get<T>(path: string, config?: AxiosRequestConfig): Promise<T> {
    const res = await this.withRetry<T>(
      () =>
        firstValueFrom(this.httpService.get<T>(path, this.baseConfig(config))),
      { retryServerErrors: true, allowRetry: true },
    )
    return res.data
  }

  async post<T>(
    path: string,
    body?: unknown,
    config?: AxiosRequestConfig,
  ): Promise<T> {
    // A multipart stream (FormData) is consumed on the first send and can't be
    // replayed, so a retried POST would send an empty body — don't retry it.
    // A future POST carrying a raw stream must extend this guard likewise.
    const res = await this.withRetry<T>(
      () =>
        firstValueFrom(
          this.httpService.post<T>(path, body, this.baseConfig(config)),
        ),
      { retryServerErrors: false, allowRetry: !(body instanceof FormData) },
    )
    return res.data
  }
}
