import { ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { User, UserRole } from '../../generated/prisma'
import { describe, expect, it, vi } from 'vitest'
import { IncomingRequest } from '@/authentication/authentication.types'
import { RolesGuard } from './Roles.guard'

const userWithRoles = (roles: UserRole[]): IncomingRequest['user'] =>
  ({ roles }) as unknown as User & { impersonating?: boolean }

const buildContext = (req: IncomingRequest): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => ({}),
    getClass: () => ({}),
  }) as unknown as ExecutionContext

const reflectorReturning = (roles: UserRole[] | undefined): Reflector =>
  ({
    getAllAndOverride: vi.fn().mockReturnValue(roles),
  }) as unknown as Reflector

describe('RolesGuard', () => {
  it('allows any request when no @Roles() metadata is present', () => {
    const guard = new RolesGuard(reflectorReturning(undefined))
    const req = { user: undefined } as IncomingRequest

    expect(guard.canActivate(buildContext(req))).toBe(true)
  })

  it('allows when the user has a required role', () => {
    const guard = new RolesGuard(reflectorReturning([UserRole.admin]))
    const req = { user: userWithRoles([UserRole.admin]) } as IncomingRequest

    expect(guard.canActivate(buildContext(req))).toBe(true)
  })

  it('denies when the user lacks every required role', () => {
    const guard = new RolesGuard(reflectorReturning([UserRole.admin]))
    const req = { user: userWithRoles([UserRole.candidate]) } as IncomingRequest

    expect(guard.canActivate(buildContext(req))).toBe(false)
  })

  it('allows when the user holds one of several accepted roles', () => {
    const guard = new RolesGuard(
      reflectorReturning([UserRole.admin, UserRole.sales]),
    )
    const req = { user: userWithRoles([UserRole.sales]) } as IncomingRequest

    expect(guard.canActivate(buildContext(req))).toBe(true)
  })

  it('denies an empty @Roles() list (no role can satisfy it)', () => {
    const guard = new RolesGuard(reflectorReturning([]))
    const req = { user: userWithRoles([UserRole.admin]) } as IncomingRequest

    expect(guard.canActivate(buildContext(req))).toBe(false)
  })

  it('denies when there is no authenticated user', () => {
    const guard = new RolesGuard(reflectorReturning([UserRole.admin]))
    const req = { user: undefined } as IncomingRequest

    expect(guard.canActivate(buildContext(req))).toBe(false)
  })

  it('denies when the user has an empty roles array', () => {
    const guard = new RolesGuard(reflectorReturning([UserRole.admin]))
    const req = { user: userWithRoles([]) } as IncomingRequest

    expect(guard.canActivate(buildContext(req))).toBe(false)
  })

  it('authorizes against the impersonated actor, not the subject', () => {
    const guard = new RolesGuard(reflectorReturning([UserRole.admin]))
    const req = {
      user: userWithRoles([UserRole.candidate]),
      actorUser: userWithRoles([UserRole.admin]) as User,
    } as IncomingRequest

    expect(guard.canActivate(buildContext(req))).toBe(true)
  })

  it('denies when the actor lacks the role even if the subject has it', () => {
    const guard = new RolesGuard(reflectorReturning([UserRole.admin]))
    const req = {
      user: userWithRoles([UserRole.admin]),
      actorUser: userWithRoles([UserRole.candidate]) as User,
    } as IncomingRequest

    expect(guard.canActivate(buildContext(req))).toBe(false)
  })
})
