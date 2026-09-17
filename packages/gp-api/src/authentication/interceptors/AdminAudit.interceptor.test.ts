import { CallHandler, ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { User, UserRole } from '../../generated/prisma'
import { PinoLogger } from 'nestjs-pino'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminAuditInterceptor } from './AdminAudit.interceptor'

const asUser = (id: number, email: string): User =>
  ({ id, email }) as unknown as User

type RequestOverrides = {
  user?: User
  actorUser?: User
  actorSub?: string
}

const buildContext = (overrides: RequestOverrides): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({
        method: 'DELETE',
        url: '/v1/admin/users/7',
        ip: '203.0.113.9',
        headers: { 'user-agent': 'vitest' },
        body: { reason: 'cleanup' },
        ...overrides,
      }),
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  }) as unknown as ExecutionContext

const nextHandler = (): CallHandler => ({ handle: vi.fn() })

describe('AdminAuditInterceptor', () => {
  let logger: PinoLogger
  let interceptor: AdminAuditInterceptor

  const withRoles = (roles: UserRole[] | undefined) =>
    new AdminAuditInterceptor(
      {
        getAllAndOverride: vi.fn().mockReturnValue(roles),
      } as unknown as Reflector,
      logger,
    )

  const loggedAudit = () =>
    vi.mocked(logger.info).mock.calls[0]?.[0] as Record<string, unknown>

  beforeEach(() => {
    logger = {
      info: vi.fn(),
      setContext: vi.fn(),
    } as unknown as PinoLogger
    interceptor = withRoles([UserRole.admin])
  })

  it('does not log routes that are not admin-gated', () => {
    withRoles([UserRole.candidate]).intercept(
      buildContext({ user: asUser(7, 'candidate@example.com') }),
      nextHandler(),
    )

    expect(logger.info).not.toHaveBeenCalled()
  })

  it('does not log routes with no @Roles() metadata', () => {
    withRoles(undefined).intercept(
      buildContext({ user: asUser(7, 'candidate@example.com') }),
      nextHandler(),
    )

    expect(logger.info).not.toHaveBeenCalled()
  })

  it('records the admin acting as themselves', () => {
    interceptor.intercept(
      buildContext({ user: asUser(99, 'admin@goodparty.org') }),
      nextHandler(),
    )

    expect(loggedAudit()).toMatchObject({
      userId: 99,
      userEmail: 'admin@goodparty.org',
      endpoint: '/v1/admin/users/7',
      httpMethod: 'DELETE',
      msg: 'Admin route accessed',
    })
  })

  it('omits impersonation fields when nobody is being impersonated', () => {
    // Their absence has to mean "acted as themselves" rather than "we failed
    // to record it", otherwise the field is useless for an auditor.
    interceptor.intercept(
      buildContext({ user: asUser(99, 'admin@goodparty.org') }),
      nextHandler(),
    )

    expect(loggedAudit()).not.toHaveProperty('impersonatedUserId')
    expect(loggedAudit()).not.toHaveProperty('unresolvedActorSub')
  })

  it('attributes an impersonated request to the admin, not the subject', () => {
    // RolesGuard admits these routes on the actor's roles, so the actor is
    // the accountable human. Naming the subject pointed the trail at the
    // person the admin acted upon.
    interceptor.intercept(
      buildContext({
        user: asUser(7, 'candidate@example.com'),
        actorUser: asUser(99, 'admin@goodparty.org'),
        actorSub: 'user_clerkadmin',
      }),
      nextHandler(),
    )

    expect(loggedAudit()).toMatchObject({
      userId: 99,
      userEmail: 'admin@goodparty.org',
      impersonatedUserId: 7,
      impersonatedUserEmail: 'candidate@example.com',
    })
  })

  it('flags an act claim that never resolved to a local user', () => {
    // SessionGuard warns and continues here, and RolesGuard then falls back
    // to the subject's own roles — so the subject is genuinely the authorized
    // party, but the trail should not silently drop that impersonation was
    // in play.
    interceptor.intercept(
      buildContext({
        user: asUser(99, 'admin@goodparty.org'),
        actorSub: 'user_unresolved',
      }),
      nextHandler(),
    )

    expect(loggedAudit()).toMatchObject({
      userId: 99,
      unresolvedActorSub: 'user_unresolved',
    })
    expect(loggedAudit()).not.toHaveProperty('impersonatedUserId')
  })

  it('always calls the next handler', () => {
    const next = nextHandler()

    interceptor.intercept(
      buildContext({ user: asUser(99, 'admin@goodparty.org') }),
      next,
    )

    expect(next.handle).toHaveBeenCalledOnce()
  })
})
