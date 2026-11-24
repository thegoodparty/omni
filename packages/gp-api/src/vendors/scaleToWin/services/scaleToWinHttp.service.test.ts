import { HttpService } from '@nestjs/axios'
import { AxiosError, AxiosHeaders, AxiosResponse } from 'axios'
import { PinoLogger } from 'nestjs-pino'
import { of, throwError } from 'rxjs'
import { Readable } from 'stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import {
  ScaleToWinApiError,
  ScaleToWinHttpService,
} from './scaleToWinHttp.service'

const axiosError = (
  status: number,
  data: object = { message: 'boom', code: 'SERVER_ERROR' },
): AxiosError => {
  const config = { url: '/x', headers: new AxiosHeaders() }
  const response = {
    data,
    status,
    statusText: 'err',
    headers: {},
    config: config as AxiosResponse['config'],
  } as AxiosResponse
  return new AxiosError(
    'failed',
    'ERR',
    config as AxiosError['config'],
    {},
    response,
  )
}

const ok = <T>(data: T): AxiosResponse<T> =>
  ({
    data,
    status: 200,
    statusText: 'ok',
    headers: {},
    config: {} as AxiosResponse['config'],
  }) as AxiosResponse<T>

describe('ScaleToWinHttpService', () => {
  let service: ScaleToWinHttpService
  let logger: PinoLogger
  let http: {
    get: ReturnType<typeof vi.fn>
    post: ReturnType<typeof vi.fn>
    put: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    http = { get: vi.fn(), post: vi.fn(), put: vi.fn() }
    logger = createMockLogger()
    service = new ScaleToWinHttpService(logger, http as unknown as HttpService)
  })

  afterEach(() => vi.useRealTimers())

  it('sends basic auth with the key id and secret', async () => {
    http.get.mockReturnValue(of(ok({ id: 'c1' })))

    await service.get('/subaccounts/s/campaigns/c1', 'endpoint')

    const [, config] = http.get.mock.calls[0] ?? []
    expect(config.auth).toEqual({
      username: 'mock-key-id',
      password: 'mock-key-secret',
    })
    expect(config.baseURL).toMatch(/\/v1\/vendor-mocks\/scaleToWin$/)
  })

  it('sends {} on a POST with no body', async () => {
    http.post.mockReturnValue(of(ok({})))

    await service.post('/subaccounts/s/campaigns/c1/start', 'endpoint')

    const [, body] = http.post.mock.calls[0] ?? []
    expect(body).toEqual({})
  })

  it('retries a POST on a 429, then succeeds', async () => {
    vi.useFakeTimers()
    http.post
      .mockReturnValueOnce(throwError(() => axiosError(429)))
      .mockReturnValueOnce(of(ok({ status: 'RUNNING' })))

    const result = service.post('/x', 'endpoint', { a: 1 })
    await vi.runAllTimersAsync()

    await expect(result).resolves.toEqual({ status: 'RUNNING' })
    expect(http.post).toHaveBeenCalledTimes(2)
  })

  it('does not retry a POST on a 5xx', async () => {
    http.post.mockReturnValue(throwError(() => axiosError(500)))

    await expect(service.post('/x', 'endpoint')).rejects.toBeInstanceOf(
      ScaleToWinApiError,
    )
    expect(http.post).toHaveBeenCalledTimes(1)
  })

  it('retries a GET on a 5xx, then succeeds', async () => {
    vi.useFakeTimers()
    http.get
      .mockReturnValueOnce(throwError(() => axiosError(503)))
      .mockReturnValueOnce(of(ok({ status: 'DONE' })))

    const result = service.get('/x', 'endpoint')
    await vi.runAllTimersAsync()

    await expect(result).resolves.toEqual({ status: 'DONE' })
    expect(http.get).toHaveBeenCalledTimes(2)
  })

  it('gives up a GET after the retry cap', async () => {
    vi.useFakeTimers()
    http.get.mockReturnValue(throwError(() => axiosError(500)))

    const result = service.get('/x', 'endpoint')
    const assertion = expect(result).rejects.toBeInstanceOf(ScaleToWinApiError)
    await vi.runAllTimersAsync()
    await assertion
    expect(http.get).toHaveBeenCalledTimes(3)
  })

  it('maps a 4xx error body to a typed error with the Scale to Win code', async () => {
    http.get.mockReturnValue(
      throwError(() =>
        axiosError(404, {
          message: 'No campaign with that ID found in that subaccount',
          code: 'NOT_FOUND',
        }),
      ),
    )

    const error = await service
      .get('/x', '/subaccounts/:subaccountId/campaigns/:id')
      .catch((err: Error) => err)

    expect(error).toBeInstanceOf(ScaleToWinApiError)
    expect(error).toMatchObject({ vendorStatus: 404, code: 'NOT_FOUND' })
    expect(http.get).toHaveBeenCalledTimes(1)
  })

  it('stringifies a numeric error code', async () => {
    http.post.mockReturnValue(
      throwError(() => axiosError(409, { message: 'busy', code: 4091 })),
    )

    await expect(service.post('/x', 'endpoint')).rejects.toMatchObject({
      vendorStatus: 409,
      code: '4091',
    })
  })

  it('PUTs the CSV stream to the presigned URL without auth and never retries', async () => {
    const stream = Readable.from(['firstName,cellPhone\n'])
    http.put.mockReturnValue(throwError(() => axiosError(429)))

    await expect(
      service.putPresigned('https://uploads.example/abc?sig=s', stream, 20),
    ).rejects.toBeInstanceOf(ScaleToWinApiError)

    const [url, body, config] = http.put.mock.calls[0] ?? []
    expect(url).toBe('https://uploads.example/abc?sig=s')
    expect(body).toBe(stream)
    expect(config.auth).toBeUndefined()
    expect(config.baseURL).toBeUndefined()
    expect(config.headers).toEqual({
      'Content-Type': 'text/csv',
      'Content-Length': '20',
    })
    expect(http.put).toHaveBeenCalledTimes(1)
  })

  it('never logs the presigned URL on a failed upload', async () => {
    http.put.mockReturnValue(throwError(() => axiosError(403)))

    await service
      .putPresigned('https://uploads.example/secret-sig', Readable.from([]), 0)
      .catch(() => undefined)

    expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).not.toContain(
      'secret-sig',
    )
  })
})
