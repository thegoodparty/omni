import { HttpService } from '@nestjs/axios'
import { AxiosError, AxiosHeaders, AxiosResponse } from 'axios'
import FormData from 'form-data'
import { of, throwError } from 'rxjs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'

const axiosError = (status: number): AxiosError => {
  const config = { url: '/x', headers: new AxiosHeaders() }
  const response = {
    data: { message: 'boom' },
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

type MockHttp = {
  get: ReturnType<typeof vi.fn>
  post: ReturnType<typeof vi.fn>
  put: ReturnType<typeof vi.fn>
}

const loadService = async (http: MockHttp) => {
  vi.resetModules()
  vi.stubEnv('CALLFIRE_LOGIN', 'user')
  vi.stubEnv('CALLFIRE_PASSWORD', 'pass')
  const { CallfireHttpService } = await import('./callfireHttp.service.js')
  return new CallfireHttpService(
    createMockLogger(),
    http as unknown as HttpService,
  )
}

describe('CallfireHttpService', () => {
  let http: MockHttp

  beforeEach(() => {
    http = { get: vi.fn(), post: vi.fn(), put: vi.fn() }
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('injects HTTP Basic auth built from login:password', async () => {
    http.get.mockReturnValue(of(ok({ ok: true })))
    const service = await loadService(http)

    await service.get('/campaigns/voice')

    const config = http.get.mock.calls[0]?.[1] as {
      headers: Record<string, string>
    }
    // base64('user:pass') === 'dXNlcjpwYXNz'
    expect(config.headers.Authorization).toBe('Basic dXNlcjpwYXNz')
  })

  it('does not retry a POST on a 5xx', async () => {
    // A write may have already executed; retrying could double a charge.
    http.post.mockReturnValue(throwError(() => axiosError(500)))
    const service = await loadService(http)

    await expect(service.post('/numbers', {})).rejects.toBeInstanceOf(
      AxiosError,
    )
    expect(http.post).toHaveBeenCalledTimes(1)
  })

  it('does not retry a POST carrying a consumed multipart stream', async () => {
    // FormData is a one-shot stream; a retry would send an empty body.
    const form = new FormData()
    form.append('file', Buffer.from('x'), { filename: 'a.wav' })
    http.post.mockReturnValue(throwError(() => axiosError(429)))
    const service = await loadService(http)

    await expect(service.post('/media', form)).rejects.toBeInstanceOf(
      AxiosError,
    )
    expect(http.post).toHaveBeenCalledTimes(1)
  })

  it('retries a POST on a 429 throttle, then succeeds', async () => {
    const service = await loadService(http)
    vi.useFakeTimers()
    http.post
      .mockReturnValueOnce(throwError(() => axiosError(429)))
      .mockReturnValueOnce(of(ok({ ok: true })))

    const result = service.post('/numbers', {})
    await vi.runAllTimersAsync()

    await expect(result).resolves.toEqual({ ok: true })
    expect(http.post).toHaveBeenCalledTimes(2)
  })

  it('retries an idempotent GET on a 5xx, then succeeds', async () => {
    const service = await loadService(http)
    vi.useFakeTimers()
    http.get
      .mockReturnValueOnce(throwError(() => axiosError(503)))
      .mockReturnValueOnce(of(ok({ items: [] })))

    const result = service.get('/dncs')
    await vi.runAllTimersAsync()

    await expect(result).resolves.toEqual({ items: [] })
    expect(http.get).toHaveBeenCalledTimes(2)
  })

  it('gives up a GET after the retry cap', async () => {
    const service = await loadService(http)
    vi.useFakeTimers()
    http.get.mockReturnValue(throwError(() => axiosError(500)))

    const result = service.get('/dncs')
    const assertion = expect(result).rejects.toBeInstanceOf(AxiosError)
    await vi.runAllTimersAsync()
    await assertion
    // initial attempt + MAX_RETRIES (2)
    expect(http.get).toHaveBeenCalledTimes(3)
  })

  it('does not retry a PUT on a 5xx', async () => {
    // A state-transitioning PUT may already have executed; retrying could
    // re-trigger the side effect.
    http.put.mockReturnValue(throwError(() => axiosError(500)))
    const service = await loadService(http)

    await expect(
      service.put('/campaigns/voice/1', { state: 'START' }),
    ).rejects.toBeInstanceOf(AxiosError)
    expect(http.put).toHaveBeenCalledTimes(1)
  })
})
