import { HttpService } from '@nestjs/axios'
import { AxiosError, AxiosHeaders, AxiosResponse } from 'axios'
import { of, throwError } from 'rxjs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { CallhubHttpService } from './callhubHttp.service'

const axiosError = (status: number): AxiosError => {
  const config = { url: '/x', headers: new AxiosHeaders() }
  const response = {
    data: { detail: 'boom' },
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

describe('CallhubHttpService', () => {
  let service: CallhubHttpService
  let http: { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    http = { get: vi.fn(), post: vi.fn() }
    service = new CallhubHttpService(
      createMockLogger(),
      http as unknown as HttpService,
    )
  })

  afterEach(() => vi.useRealTimers())

  it('does not retry a POST on a 5xx', async () => {
    // A write may have already executed; retrying could double a charge.
    http.post.mockReturnValue(throwError(() => axiosError(500)))

    await expect(service.post('/v1/numbers/rent/', {})).rejects.toBeInstanceOf(
      AxiosError,
    )
    expect(http.post).toHaveBeenCalledTimes(1)
  })

  it('retries a POST on a 429 throttle, then succeeds', async () => {
    vi.useFakeTimers()
    http.post
      .mockReturnValueOnce(throwError(() => axiosError(429)))
      .mockReturnValueOnce(of(ok({ ok: true })))

    const result = service.post('/v1/numbers/rent/', {})
    await vi.runAllTimersAsync()

    await expect(result).resolves.toEqual({ ok: true })
    expect(http.post).toHaveBeenCalledTimes(2)
  })

  it('retries an idempotent GET on a 5xx, then succeeds', async () => {
    vi.useFakeTimers()
    http.get
      .mockReturnValueOnce(throwError(() => axiosError(503)))
      .mockReturnValueOnce(of(ok({ results: [] })))

    const result = service.get('/v1/dnc_contacts/')
    await vi.runAllTimersAsync()

    await expect(result).resolves.toEqual({ results: [] })
    expect(http.get).toHaveBeenCalledTimes(2)
  })

  it('gives up a GET after the retry cap', async () => {
    vi.useFakeTimers()
    http.get.mockReturnValue(throwError(() => axiosError(500)))

    const result = service.get('/v1/dnc_contacts/')
    const assertion = expect(result).rejects.toBeInstanceOf(AxiosError)
    await vi.runAllTimersAsync()
    await assertion
    // initial attempt + MAX_RETRIES (2)
    expect(http.get).toHaveBeenCalledTimes(3)
  })
})
