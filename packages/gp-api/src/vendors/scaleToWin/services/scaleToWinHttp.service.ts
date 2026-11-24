import { HttpService } from '@nestjs/axios'
import { BadGatewayException, Injectable } from '@nestjs/common'
import { AxiosRequestConfig, AxiosResponse, isAxiosError } from 'axios'
import { Headers, MimeTypes } from 'http-constants-ts'
import { PinoLogger } from 'nestjs-pino'
import { firstValueFrom } from 'rxjs'
import { Readable } from 'stream'
import { z } from 'zod'
import { parseVendorResponse } from '../../shared/parseVendorResponse'
import { ScaleToWinBaseConfig } from '../config/scaleToWinBaseConfig'

const MAX_RETRIES = 2
const RETRY_BASE_DELAY_MS = 1000
// Plain numbers, not HttpStatus: axios reports status as a number, and
// comparing that to the HttpStatus enum trips no-unsafe-enum-comparison.
const HTTP_TOO_MANY_REQUESTS = 429
const HTTP_SERVER_ERROR_MIN = 500

const ErrorBodySchema = z.object({
  message: z.string().nullish(),
  code: z.union([z.string(), z.number()]).nullish(),
})

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

// Carries Scale to Win's own `code` so a caller can name the stop reason
// (`copy_<code>`). No axios cause is attached: its config holds the basic
// auth header, or the presigned URL on an upload.
export class ScaleToWinApiError extends BadGatewayException {
  constructor(
    message: string,
    readonly vendorStatus: number | undefined,
    readonly code: string | undefined,
  ) {
    super(message)
  }
}

@Injectable()
export class ScaleToWinHttpService extends ScaleToWinBaseConfig {
  constructor(
    protected readonly logger: PinoLogger,
    private readonly httpService: HttpService,
  ) {
    super(logger)
  }

  subaccountPath(path: string): string {
    return `/subaccounts/${encodeURIComponent(this.subaccountId)}${path}`
  }

  parse<S extends z.ZodType>(
    schema: S,
    body: unknown,
    endpoint: string,
  ): z.infer<S> {
    return parseVendorResponse(schema, body, {
      vendor: 'scaleToWin',
      endpoint,
      mode: 'enforce',
      logger: this.logger,
    })
  }

  async get(path: string, endpoint: string): Promise<unknown> {
    const res = await this.withRetry(
      () => firstValueFrom(this.httpService.get(path, this.authConfig())),
      true,
      endpoint,
    )
    return res.data
  }

  async post(
    path: string,
    endpoint: string,
    body: object = {},
  ): Promise<unknown> {
    const res = await this.withRetry(
      () =>
        firstValueFrom(this.httpService.post(path, body, this.authConfig())),
      false,
      endpoint,
    )
    return res.data
  }

  // The presigned URL is itself the credential, so no basic auth goes with
  // it. Never retried: the stream is consumed by the first attempt.
  async putPresigned(
    signedPutUrl: string,
    body: Readable,
    contentLength: number,
  ): Promise<void> {
    try {
      await firstValueFrom(
        this.httpService.put(signedPutUrl, body, {
          timeout: this.httpTimeoutMs,
          headers: {
            [Headers.CONTENT_TYPE]: MimeTypes.IMAGE_CSV,
            [Headers.CONTENT_LENGTH]: String(contentLength),
          },
        }),
      )
    } catch (error) {
      throw this.toApiError(error, 'PUT presigned upload')
    }
  }

  private authConfig(): AxiosRequestConfig {
    return {
      baseURL: this.baseUrl,
      timeout: this.httpTimeoutMs,
      auth: this.credentials,
    }
  }

  // A 429 is rejected before the request is processed, so retrying is always
  // safe. A 5xx may have already executed the request, so it is only retried
  // for idempotent GETs: retrying a copy or a send-full could double it.
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

  private async withRetry(
    send: () => Promise<AxiosResponse<unknown>>,
    retryServerErrors: boolean,
    endpoint: string,
  ): Promise<AxiosResponse<unknown>> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await send()
      } catch (error) {
        if (
          attempt === MAX_RETRIES ||
          !this.isRetryable(error, retryServerErrors)
        ) {
          throw this.toApiError(error, endpoint)
        }
        await sleep(RETRY_BASE_DELAY_MS * (attempt + 1))
      }
    }
  }

  // Logs the status and Scale to Win's message and code only. Never the
  // request config: it carries the auth header or the presigned URL.
  private toApiError(error: unknown, endpoint: string): ScaleToWinApiError {
    const vendorStatus = isAxiosError(error)
      ? error.response?.status
      : undefined
    const parsed = isAxiosError(error)
      ? ErrorBodySchema.safeParse(error.response?.data)
      : undefined
    const body = parsed?.success ? parsed.data : undefined
    const code = body?.code == null ? undefined : String(body.code)
    this.logger.error(
      {
        endpoint,
        vendorStatus,
        code,
        vendorMessage: body?.message,
        errorCode: isAxiosError(error) ? error.code : undefined,
      },
      'Scale to Win API call failed',
    )
    return new ScaleToWinApiError(
      `Scale to Win ${endpoint} failed` +
        (vendorStatus ? ` (${vendorStatus}${code ? ` ${code}` : ''})` : ''),
      vendorStatus,
      code,
    )
  }
}
