import { describe, expect, it, vi } from 'vitest'
import { runSeedLogin } from './seedLogin'

const jsonResponse = (status: number, body: unknown): Response =>
  ({
    status,
    json: async () => body,
  }) as Response

describe('runSeedLogin', () => {
  it('skips cleanly when the machine secret is absent', async () => {
    const fetchImpl = vi.fn()
    const result = await runSeedLogin('', 'free-win', fetchImpl)
    expect(result).toEqual({
      kind: 'skipped',
      reason: 'LOCAL_SETUP_CLERK_MACHINE_SECRET not set',
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('mints a token then a fixture user on the happy path', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(201, { token: 'mt_abc' }))
      .mockResolvedValueOnce(
        jsonResponse(201, {
          email: 'qa-123@goodparty.org',
          password: 'correct-horse',
        }),
      )

    const result = await runSeedLogin('secret_123', 'pro-win', fetchImpl)

    expect(result).toEqual({
      kind: 'minted',
      email: 'qa-123@goodparty.org',
      password: 'correct-horse',
    })
    expect(fetchImpl).toHaveBeenCalledTimes(2)

    const [mintUrl, mintInit] = fetchImpl.mock.calls[0]
    expect(mintUrl).toBe('https://api.clerk.com/v1/m2m_tokens')
    expect(mintInit.headers.Authorization).toBe('Bearer secret_123')
    expect(JSON.parse(mintInit.body)).toEqual({
      seconds_until_expiration: 3600,
    })

    const [fixtureUrl, fixtureInit] = fetchImpl.mock.calls[1]
    expect(fixtureUrl).toBe('http://localhost:3000/v1/test-fixtures/users')
    expect(fixtureInit.headers.Authorization).toBe('Bearer mt_abc')
    expect(JSON.parse(fixtureInit.body)).toEqual({ state: 'pro-win' })
  })

  it('fails when Clerk rejects the machine secret', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(401, {}))

    const result = await runSeedLogin('bad-secret', 'free-win', fetchImpl)

    expect(result).toEqual({
      kind: 'failed',
      reason: 'Clerk M2M token mint failed: HTTP 401',
    })
    // Never calls gp-api with a token that was never minted.
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('fails when the guard rejects the minted token against test-fixtures', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(201, { token: 'mt_abc' }))
      .mockResolvedValueOnce(jsonResponse(401, {}))

    const result = await runSeedLogin('secret_123', 'free-win', fetchImpl)

    expect(result).toEqual({
      kind: 'failed',
      reason: 'test-fixtures/users failed: HTTP 401',
    })
  })

  it('fails when Clerk returns 201 with no token', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(201, {}))

    const result = await runSeedLogin('secret_123', 'free-win', fetchImpl)

    expect(result).toEqual({
      kind: 'failed',
      reason: 'Clerk M2M token mint returned no token',
    })
  })

  it('fails when test-fixtures returns 201 with no email/password', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(201, { token: 'mt_abc' }))
      .mockResolvedValueOnce(
        jsonResponse(201, { email: 'qa-123@goodparty.org' }),
      )

    const result = await runSeedLogin('secret_123', 'free-win', fetchImpl)

    expect(result).toEqual({
      kind: 'failed',
      reason: 'test-fixtures/users response missing email/password',
    })
  })
})
