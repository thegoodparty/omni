import { CallHandler, ExecutionContext } from '@nestjs/common'
import { of, lastValueFrom, from } from 'rxjs'
import { describe, expect, it } from 'vitest'
import { ImpersonationInterceptor } from './Impersonation.interceptor'
import { getActorContext, ActorContext } from '../impersonation-context'
import { Organization, OrganizationRole } from '../../generated/prisma'

function createMockContext(
  user?: { id?: number; impersonating?: boolean },
  actorSub?: string,
  organization?: Organization,
  organizationRole?: OrganizationRole,
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user, actorSub, organization, organizationRole }),
    }),
  } as unknown as ExecutionContext
}

function createMockHandler(fn?: () => unknown): CallHandler {
  return {
    handle: () => of(fn ? fn() : 'ok'),
  }
}

describe('ImpersonationInterceptor', () => {
  const interceptor = new ImpersonationInterceptor()

  it('sets isImpersonating to true when JWT has impersonating claim', async () => {
    let captured: ActorContext | undefined

    const context = createMockContext({ id: 1, impersonating: true })
    const handler = createMockHandler(() => {
      captured = getActorContext()
      return 'result'
    })

    const result$ = interceptor.intercept(context, handler)
    const result = await lastValueFrom(result$)

    expect(captured?.isImpersonating).toBe(true)
    expect(result).toBe('result')
  })

  it('sets isImpersonating to false when no user on request', async () => {
    let captured: ActorContext | undefined

    const context = createMockContext(undefined)
    const handler = createMockHandler(() => {
      captured = getActorContext()
      return 'result'
    })

    const result$ = interceptor.intercept(context, handler)
    await lastValueFrom(result$)

    expect(captured?.isImpersonating).toBe(false)
  })

  it('does not leak context after the observable completes', async () => {
    const context = createMockContext({ id: 1, impersonating: true })
    const handler = createMockHandler(() => 'done')

    const result$ = interceptor.intercept(context, handler)
    await lastValueFrom(result$)

    expect(getActorContext()).toBeUndefined()
  })

  it('propagates context through async handler', async () => {
    let captured: ActorContext | undefined

    const context = createMockContext({ id: 1, impersonating: true })
    const handler: CallHandler = {
      handle: () =>
        from(
          (async () => {
            await new Promise((r) => setTimeout(r, 1))
            captured = getActorContext()
            return 'async-result'
          })(),
        ),
    }

    const result$ = interceptor.intercept(context, handler)
    const result = await lastValueFrom(result$)

    expect(captured?.isImpersonating).toBe(true)
    expect(result).toBe('async-result')
  })

  it('sets isImpersonating to true for degraded actor (actorSub set, impersonating false)', async () => {
    let captured: ActorContext | undefined

    const context = createMockContext(
      { id: 1, impersonating: false },
      'admin@goodparty.org',
    )
    const handler = createMockHandler(() => {
      captured = getActorContext()
      return 'result'
    })

    const result$ = interceptor.intercept(context, handler)
    const result = await lastValueFrom(result$)

    expect(captured?.isImpersonating).toBe(true)
    expect(result).toBe('result')
  })

  it('sets isImpersonating to true when actorSub is set and user is absent (M2M path)', async () => {
    let captured: ActorContext | undefined

    const context = createMockContext(undefined, 'admin@goodparty.org')
    const handler = createMockHandler(() => {
      captured = getActorContext()
      return 'result'
    })

    const result$ = interceptor.intercept(context, handler)
    const result = await lastValueFrom(result$)

    expect(captured?.isImpersonating).toBe(true)
    expect(result).toBe('result')
  })

  it('sets actorUserId from request.user.id', async () => {
    let captured: ActorContext | undefined

    const context = createMockContext({ id: 42 })
    const handler = createMockHandler(() => {
      captured = getActorContext()
      return 'result'
    })

    await lastValueFrom(interceptor.intercept(context, handler))

    expect(captured?.actorUserId).toBe(42)
  })

  it('sets actorUserId to null when there is no request.user', async () => {
    let captured: ActorContext | undefined

    const context = createMockContext(undefined)
    const handler = createMockHandler(() => {
      captured = getActorContext()
      return 'result'
    })

    await lastValueFrom(interceptor.intercept(context, handler))

    expect(captured?.actorUserId).toBeNull()
  })

  it('sets actorRole from request.organizationRole when the guards attached one', async () => {
    let captured: ActorContext | undefined

    const context = createMockContext(
      { id: 42 },
      undefined,
      undefined,
      OrganizationRole.campaignAdmin,
    )
    const handler = createMockHandler(() => {
      captured = getActorContext()
      return 'result'
    })

    await lastValueFrom(interceptor.intercept(context, handler))

    expect(captured?.actorRole).toBe(OrganizationRole.campaignAdmin)
  })

  it('falls back to owner when request.organization.ownerId matches the actor but no role was attached', async () => {
    let captured: ActorContext | undefined

    const organization = { slug: 'org-1', ownerId: 42 } as Organization
    const context = createMockContext({ id: 42 }, undefined, organization)
    const handler = createMockHandler(() => {
      captured = getActorContext()
      return 'result'
    })

    await lastValueFrom(interceptor.intercept(context, handler))

    expect(captured?.actorRole).toBe(OrganizationRole.owner)
  })

  it('leaves actorRole null when there is no organizationRole and no owner match', async () => {
    let captured: ActorContext | undefined

    const organization = { slug: 'org-2', ownerId: 99 } as Organization
    const context = createMockContext({ id: 42 }, undefined, organization)
    const handler = createMockHandler(() => {
      captured = getActorContext()
      return 'result'
    })

    await lastValueFrom(interceptor.intercept(context, handler))

    expect(captured?.actorRole).toBeNull()
  })

  it('leaves actorRole null for non-org-scoped requests (no organization, no role)', async () => {
    let captured: ActorContext | undefined

    const context = createMockContext({ id: 42 })
    const handler = createMockHandler(() => {
      captured = getActorContext()
      return 'result'
    })

    await lastValueFrom(interceptor.intercept(context, handler))

    expect(captured?.actorRole).toBeNull()
  })
})
