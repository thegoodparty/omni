import { HttpStatus } from '@nestjs/common'
import { ClerkClient } from '@clerk/backend'
import { IMPERSONATION_TARGET_BANNED_ERROR_CODE } from '@goodparty_org/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { CLERK_CLIENT_PROVIDER_TOKEN } from '@/vendors/clerk/providers/clerk-client.provider'
import { UserRole } from '../../generated/prisma'

const service = useTestService()

const actorToken = (token: string) =>
  ({ token }) as Awaited<ReturnType<ClerkClient['actorTokens']['create']>>

describe('admin impersonation and Clerk ban status', () => {
  let clerkClient: ClerkClient

  beforeEach(async () => {
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { roles: [UserRole.admin] },
    })
    clerkClient = service.app.get<ClerkClient>(CLERK_CLIENT_PROVIDER_TOKEN)
  })

  it('answers 409 with TARGET_USER_BANNED instead of minting a ticket', async () => {
    vi.spyOn(clerkClient.users, 'getUser').mockResolvedValue({
      banned: true,
    } as Awaited<ReturnType<ClerkClient['users']['getUser']>>)
    const createActorToken = vi
      .spyOn(clerkClient.actorTokens, 'create')
      .mockResolvedValue(actorToken('actor_token_abc'))

    const res = await service.client.post(
      `/v1/admin/users/impersonate/${service.user.id}`,
      { actorEmail: service.user.email },
    )

    expect(res.status).toBe(HttpStatus.CONFLICT)
    expect(res.data.errorCode).toBe(IMPERSONATION_TARGET_BANNED_ERROR_CODE)
    expect(createActorToken).not.toHaveBeenCalled()
  })

  it('mints a ticket when the target is not banned', async () => {
    vi.spyOn(clerkClient.users, 'getUser').mockResolvedValue({
      banned: false,
    } as Awaited<ReturnType<ClerkClient['users']['getUser']>>)
    vi.spyOn(clerkClient.actorTokens, 'create').mockResolvedValue(
      actorToken('actor_token_abc'),
    )

    const res = await service.client.post(
      `/v1/admin/users/impersonate/${service.user.id}`,
      { actorEmail: service.user.email },
    )

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data).toEqual({ token: 'actor_token_abc' })
  })

  it('reports the Clerk ban flag for the user page badge', async () => {
    vi.spyOn(clerkClient.users, 'getUser').mockResolvedValue({
      banned: true,
    } as Awaited<ReturnType<ClerkClient['users']['getUser']>>)

    const res = await service.client.get(
      `/v1/admin/users/${service.user.id}/clerk-ban-status`,
    )

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data).toEqual({ banned: true })
  })
})
