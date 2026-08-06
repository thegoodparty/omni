import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ClerkClient } from '@clerk/backend'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { ElectionApiTokenService } from './electionApiToken.service'

// ClerkClient is a type-only export, but SWC emits it as runtime decorator
// metadata for the constructor param, so the mock must expose a placeholder.
vi.mock('@clerk/backend', () => ({
  createClerkClient: vi.fn(),
  ClerkClient: class {},
}))

// Clerk's createToken returns `expiration` as a Unix timestamp in seconds.
const secondsFromNow = (seconds: number): number =>
  Math.floor(Date.now() / 1000) + seconds

const makeService = (createToken: ReturnType<typeof vi.fn>) => {
  const clerkClient = {
    m2m: { createToken },
  } as unknown as ClerkClient
  return new ElectionApiTokenService(clerkClient, createMockLogger())
}

describe('ElectionApiTokenService', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('mints a JWT-format token with the gp-api machine secret', async () => {
    const createToken = vi
      .fn()
      .mockResolvedValue({ token: 'jwt-1', expiration: secondsFromNow(600) })
    const service = makeService(createToken)

    await expect(service.getToken()).resolves.toBe('jwt-1')
    expect(createToken).toHaveBeenCalledWith({
      machineSecretKey: expect.any(String),
      tokenFormat: 'jwt',
      secondsUntilExpiration: 600,
    })
  })

  it('reuses the cached token while it is still valid', async () => {
    // Regression guard: `expiration` is in seconds and must be converted to ms
    // before comparing against Date.now(); otherwise the cache never hits.
    const createToken = vi
      .fn()
      .mockResolvedValue({ token: 'jwt-1', expiration: secondsFromNow(600) })
    const service = makeService(createToken)

    await service.getToken()
    await expect(service.getToken()).resolves.toBe('jwt-1')
    expect(createToken).toHaveBeenCalledTimes(1)
  })

  it('mints a new token once the cached one is within the renewal buffer', async () => {
    const createToken = vi
      .fn()
      .mockResolvedValueOnce({ token: 'jwt-1', expiration: secondsFromNow(10) })
      .mockResolvedValueOnce({
        token: 'jwt-2',
        expiration: secondsFromNow(600),
      })
    const service = makeService(createToken)

    await expect(service.getToken()).resolves.toBe('jwt-1')
    await expect(service.getToken()).resolves.toBe('jwt-2')
    expect(createToken).toHaveBeenCalledTimes(2)
  })

  it('deduplicates concurrent callers into a single mint', async () => {
    let resolveMint!: (value: { token: string; expiration: number }) => void
    const createToken = vi.fn().mockReturnValue(
      new Promise<{ token: string; expiration: number }>((resolve) => {
        resolveMint = resolve
      }),
    )
    const service = makeService(createToken)

    const first = service.getToken()
    const second = service.getToken()
    resolveMint({ token: 'jwt-1', expiration: secondsFromNow(600) })

    await expect(first).resolves.toBe('jwt-1')
    await expect(second).resolves.toBe('jwt-1')
    expect(createToken).toHaveBeenCalledTimes(1)
  })

  it('clears the pending mint after a failure so the next call retries', async () => {
    const createToken = vi
      .fn()
      .mockRejectedValueOnce(new Error('clerk down'))
      .mockResolvedValueOnce({
        token: 'jwt-2',
        expiration: secondsFromNow(600),
      })
    const service = makeService(createToken)

    await expect(service.getToken()).rejects.toThrow('clerk down')
    await expect(service.getToken()).resolves.toBe('jwt-2')
    expect(createToken).toHaveBeenCalledTimes(2)
  })

  it('throws when Clerk returns no token', async () => {
    const createToken = vi
      .fn()
      .mockResolvedValue({ token: null, expiration: null })
    const service = makeService(createToken)

    await expect(service.getToken()).rejects.toThrow(
      'Clerk M2M token creation returned no token',
    )
  })

  it('wraps the token as a Bearer credential in authHeader', async () => {
    const createToken = vi
      .fn()
      .mockResolvedValue({ token: 'jwt-1', expiration: secondsFromNow(600) })
    const service = makeService(createToken)

    await expect(service.authHeader()).resolves.toEqual({
      Authorization: 'Bearer jwt-1',
    })
  })

  it('throws when GP_API_MACHINE_SECRET is not set', async () => {
    const previous = process.env.GP_API_MACHINE_SECRET
    delete process.env.GP_API_MACHINE_SECRET
    vi.resetModules()
    try {
      const { ElectionApiTokenService: Fresh } =
        await import('./electionApiToken.service.js')
      const createToken = vi.fn()
      const clerkClient = {
        m2m: { createToken },
      } as unknown as ClerkClient
      const service = new Fresh(clerkClient, createMockLogger())

      await expect(service.getToken()).rejects.toThrow(
        'GP_API_MACHINE_SECRET must be set',
      )
      expect(createToken).not.toHaveBeenCalled()
    } finally {
      process.env.GP_API_MACHINE_SECRET = previous
      vi.resetModules()
    }
  })
})
