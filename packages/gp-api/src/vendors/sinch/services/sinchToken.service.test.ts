import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SinchTokenService } from './sinchToken.service'

const logger = () => ({
  setContext: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
})

const CONFIGURED_ENV = {
  SINCH_KEY_ID: 'key_id',
  SINCH_KEY_SECRET: 'key_secret',
  SINCH_HTTP_TIMEOUT_MS: '15000',
}

/** SinchConfig reads env when constructed, so stub it before instantiating. */
function makeService(
  env: Record<string, string> = CONFIGURED_ENV,
): SinchTokenService {
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value)
  return new SinchTokenService(logger() as never)
}

const tokenResponse = (accessToken: string, expiresIn: number | null = 3600) =>
  ({
    ok: true,
    json: () =>
      Promise.resolve(
        expiresIn === null
          ? { access_token: accessToken }
          : { access_token: accessToken, expires_in: expiresIn },
      ),
  }) as never

const errorResponse = (status: number, text = 'nope') =>
  ({ ok: false, status, text: () => Promise.resolve(text) }) as never

describe('SinchTokenService', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('requests a token with basic auth and the client credentials grant', async () => {
    fetchMock.mockResolvedValue(tokenResponse('tok_1'))
    const service = makeService()

    await expect(service.getToken()).resolves.toBe('tok_1')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://auth.sinch.com/oauth2/token')
    expect(init.method).toBe('POST')
    expect(init.body).toBe('grant_type=client_credentials')
    const headers = init.headers as Record<string, string>
    expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded')
    expect(headers.Authorization).toBe(
      `Basic ${Buffer.from('key_id:key_secret').toString('base64')}`,
    )
  })

  it('reuses the cached token while it is still valid', async () => {
    fetchMock.mockResolvedValue(tokenResponse('tok_1'))
    const service = makeService()

    await service.getToken()
    await expect(service.getToken()).resolves.toBe('tok_1')

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('treats a token expiring inside the renewal buffer as already stale', async () => {
    // 10s of remaining life is less than the 30s buffer, so it must not be
    // handed out — an in-flight send could otherwise outlive it.
    fetchMock
      .mockResolvedValueOnce(tokenResponse('tok_1', 10))
      .mockResolvedValueOnce(tokenResponse('tok_2', 10))
    const service = makeService()

    await expect(service.getToken()).resolves.toBe('tok_1')
    await expect(service.getToken()).resolves.toBe('tok_2')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('re-mints once the cached token nears expiry', async () => {
    vi.useFakeTimers()
    fetchMock
      .mockResolvedValueOnce(tokenResponse('tok_1', 3600))
      .mockResolvedValueOnce(tokenResponse('tok_2', 3600))
    const service = makeService()

    await expect(service.getToken()).resolves.toBe('tok_1')
    vi.advanceTimersByTime(3600_000)
    await expect(service.getToken()).resolves.toBe('tok_2')
  })

  it('collapses concurrent callers into a single mint', async () => {
    fetchMock.mockResolvedValue(tokenResponse('tok_1'))
    const service = makeService()

    const results = await Promise.all([
      service.getToken(),
      service.getToken(),
      service.getToken(),
    ])

    expect(results).toEqual(['tok_1', 'tok_1', 'tok_1'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('re-mints after invalidate', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse('tok_1'))
      .mockResolvedValueOnce(tokenResponse('tok_2'))
    const service = makeService()

    await service.getToken()
    service.invalidate()

    await expect(service.getToken()).resolves.toBe('tok_2')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('throws on a non-200 and does not cache anything', async () => {
    fetchMock
      .mockResolvedValueOnce(errorResponse(401, 'invalid_client'))
      .mockResolvedValueOnce(tokenResponse('tok_1'))
    const service = makeService()

    await expect(service.getToken()).rejects.toThrow('401')
    // The failure must not poison the cache: the next call retries cleanly.
    await expect(service.getToken()).resolves.toBe('tok_1')
  })

  it('throws when the response carries no access token', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ token_type: 'bearer' }),
    } as never)
    const service = makeService()

    await expect(service.getToken()).rejects.toThrow('no access_token')
  })

  it('throws when the access key is not configured', async () => {
    const service = makeService({ SINCH_HTTP_TIMEOUT_MS: '15000' })

    await expect(service.getToken()).rejects.toThrow('SINCH_KEY_ID')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('re-mints on every call when the response omits a TTL', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse('tok_1', null))
      .mockResolvedValueOnce(tokenResponse('tok_2', null))
    const service = makeService()

    await expect(service.getToken()).resolves.toBe('tok_1')
    await expect(service.getToken()).resolves.toBe('tok_2')
  })
})
