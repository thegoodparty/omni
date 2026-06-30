import { ExecutionContext, UnauthorizedException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ClerkClient } from '@clerk/backend'
import { IS_PUBLIC_KEY } from '@/authentication/decorators/PublicAccess.decorator'
import { IncomingRequest } from '@/authentication/authentication.types'
import { ROLES_KEY } from '@/authentication/decorators/Roles.decorator'
import { UserRole } from '../../generated/prisma'
import { ClerkM2MAuthGuard } from './ClerkM2MAuth.guard'

const buildContext = (req: IncomingRequest): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => ({}),
    getClass: () => ({}),
  }) as unknown as ExecutionContext

const buildRequest = (token?: string): IncomingRequest =>
  ({
    headers: { authorization: token ? `Bearer ${token}` : undefined },
  }) as unknown as IncomingRequest

type ReflectorMeta = { isPublic?: boolean; roles?: UserRole[] }

const reflectorFor = ({ isPublic, roles }: ReflectorMeta): Reflector =>
  ({
    getAllAndOverride: vi.fn((key: string) =>
      key === IS_PUBLIC_KEY ? isPublic : key === ROLES_KEY ? roles : undefined,
    ),
  }) as unknown as Reflector

describe('ClerkM2MAuthGuard', () => {
  let verify: ReturnType<typeof vi.fn>
  let clerkClient: ClerkClient

  beforeEach(() => {
    verify = vi.fn()
    clerkClient = { m2m: { verify } } as unknown as ClerkClient
  })

  it('skips verification when there is no authorization token', async () => {
    const guard = new ClerkM2MAuthGuard(clerkClient, reflectorFor({}))
    const req = buildRequest()

    await expect(guard.canActivate(buildContext(req))).resolves.toBe(true)
    expect(req.m2mToken).toBeUndefined()
    expect(verify).not.toHaveBeenCalled()
  })

  it('skips verification for a non-M2M (non mt_) token', async () => {
    const guard = new ClerkM2MAuthGuard(clerkClient, reflectorFor({}))
    const req = buildRequest('sess_not_a_machine_token')

    await expect(guard.canActivate(buildContext(req))).resolves.toBe(true)
    expect(req.m2mToken).toBeUndefined()
    expect(verify).not.toHaveBeenCalled()
  })

  it('skips an mt_ token on a public route with no role restrictions', async () => {
    const guard = new ClerkM2MAuthGuard(
      clerkClient,
      reflectorFor({ isPublic: true }),
    )
    const req = buildRequest('mt_machine_token')

    await expect(guard.canActivate(buildContext(req))).resolves.toBe(true)
    expect(req.m2mToken).toBeUndefined()
    expect(verify).not.toHaveBeenCalled()
  })

  it('verifies an mt_ token and attaches it on a protected route', async () => {
    verify.mockResolvedValue({ id: 'm2m_1', subject: 'machine_abc' })
    const guard = new ClerkM2MAuthGuard(clerkClient, reflectorFor({}))
    const req = buildRequest('mt_machine_token')

    await expect(guard.canActivate(buildContext(req))).resolves.toBe(true)
    expect(req.m2mToken).toEqual({ id: 'm2m_1', subject: 'machine_abc' })
  })

  it('still verifies an mt_ token on a public route that also sets roles', async () => {
    verify.mockResolvedValue({ id: 'm2m_2', subject: 'machine_xyz' })
    const guard = new ClerkM2MAuthGuard(
      clerkClient,
      reflectorFor({ isPublic: true, roles: [UserRole.admin] }),
    )
    const req = buildRequest('mt_machine_token')

    await expect(guard.canActivate(buildContext(req))).resolves.toBe(true)
    expect(verify).toHaveBeenCalledOnce()
    expect(req.m2mToken).toEqual({ id: 'm2m_2', subject: 'machine_xyz' })
  })

  it('rejects when an mt_ token fails verification', async () => {
    verify.mockRejectedValue(new Error('invalid token'))
    const guard = new ClerkM2MAuthGuard(clerkClient, reflectorFor({}))
    const req = buildRequest('mt_machine_token')

    await expect(guard.canActivate(buildContext(req))).rejects.toThrow(
      UnauthorizedException,
    )
  })
})
