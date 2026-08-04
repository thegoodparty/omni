import { ExecutionContext, UnauthorizedException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { ClerkClient } from '@clerk/backend'
import { PinoLogger } from 'nestjs-pino'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { M2MAuthGuard } from './M2MAuth.guard'

const makeContext = (
  headers: Record<string, string | undefined>,
): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ headers }) as unknown,
    }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  }) as unknown as ExecutionContext

const makeGuard = (opts: {
  isPublic?: boolean
  verify?: ReturnType<typeof vi.fn>
}) => {
  const reflector = {
    getAllAndOverride: vi.fn().mockReturnValue(opts.isPublic ?? false),
  } as unknown as Reflector
  const verify =
    opts.verify ?? vi.fn().mockResolvedValue({ id: 'm', subject: 's' })
  const clerkClient = { m2m: { verify } } as unknown as ClerkClient
  const logger = {
    setContext: vi.fn(),
    warn: vi.fn(),
  } as unknown as PinoLogger
  const guard = new M2MAuthGuard(clerkClient, reflector, logger)
  return { guard, verify, logger }
}

describe('M2MAuthGuard', () => {
  const OLD_ENV = process.env

  beforeEach(() => {
    process.env = { ...OLD_ENV }
    process.env.ELECTION_API_MACHINE_SECRET = 'ak_test'
  })

  afterEach(() => {
    process.env = OLD_ENV
  })

  it('allows @PublicAccess routes without a token', async () => {
    const { guard, verify } = makeGuard({ isPublic: true })
    await expect(guard.canActivate(makeContext({}))).resolves.toBe(true)
    expect(verify).not.toHaveBeenCalled()
  })

  it('verifies a valid JWT token and tags the request', async () => {
    process.env.ELECTION_API_AUTH_ENFORCED = 'true'
    const verify = vi.fn().mockResolvedValue({ id: 'm', subject: 's' })
    const { guard } = makeGuard({ verify })
    await expect(
      guard.canActivate(makeContext({ authorization: 'Bearer eyJhbGci.abc' })),
    ).resolves.toBe(true)
    expect(verify).toHaveBeenCalledWith({
      token: 'eyJhbGci.abc',
      machineSecretKey: 'ak_test',
    })
  })

  it('rejects a missing token when enforcement is on', async () => {
    process.env.ELECTION_API_AUTH_ENFORCED = 'true'
    const { guard } = makeGuard({})
    await expect(guard.canActivate(makeContext({}))).rejects.toBeInstanceOf(
      UnauthorizedException,
    )
  })

  it('rejects a token that fails verification when enforcement is on', async () => {
    process.env.ELECTION_API_AUTH_ENFORCED = 'true'
    const verify = vi.fn().mockRejectedValue(new Error('invalid token'))
    const { guard } = makeGuard({ verify })
    await expect(
      guard.canActivate(makeContext({ authorization: 'Bearer not-a-jwt' })),
    ).rejects.toBeInstanceOf(UnauthorizedException)
  })

  it('allows (observe-only) a missing token when enforcement is off', async () => {
    process.env.ELECTION_API_AUTH_ENFORCED = 'false'
    const { guard, logger } = makeGuard({})
    await expect(guard.canActivate(makeContext({}))).resolves.toBe(true)
    expect(logger.warn).toHaveBeenCalled()
  })

  it('rejects when the machine secret is not configured (enforced)', async () => {
    process.env.ELECTION_API_AUTH_ENFORCED = 'true'
    delete process.env.ELECTION_API_MACHINE_SECRET
    const { guard } = makeGuard({})
    await expect(
      guard.canActivate(makeContext({ authorization: 'Bearer eyJhbGci.abc' })),
    ).rejects.toBeInstanceOf(UnauthorizedException)
  })
})
