import { IncomingRequest } from '@/authentication/authentication.types'
import { FeaturesService } from '@/features/services/features.service'
import { ExecutionContext, ForbiddenException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { User } from '../../generated/prisma'
import { STAFF_TEST_MODE_FLAG, TestModeGuard } from './TestMode.guard'

const staff = { id: 1, email: 'staff@goodparty.org' } as User

const contextFor = (req: Partial<IncomingRequest>): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => req }),
  }) as unknown as ExecutionContext

describe('TestModeGuard', () => {
  let isFeatureEnabled: ReturnType<typeof vi.fn>
  let guard: TestModeGuard

  beforeEach(() => {
    isFeatureEnabled = vi.fn().mockResolvedValue(true)
    guard = new TestModeGuard({
      isFeatureEnabled,
    } as unknown as FeaturesService)
  })

  it('admits an internal session user with the flag on', async () => {
    await expect(guard.canActivate(contextFor({ user: staff }))).resolves.toBe(
      true,
    )
    expect(isFeatureEnabled).toHaveBeenCalledWith({
      user: staff,
      feature: STAFF_TEST_MODE_FLAG,
    })
  })

  it('refuses a non-internal email', async () => {
    const user = { ...staff, email: 'candidate@example.com' } as User
    await expect(guard.canActivate(contextFor({ user }))).rejects.toThrow(
      ForbiddenException,
    )
    expect(isFeatureEnabled).not.toHaveBeenCalled()
  })

  it('refuses an impersonating admin even when the target is internal', async () => {
    const user = { ...staff, impersonating: true }
    const actorUser = { id: 2, email: 'admin@goodparty.org' } as User
    await expect(
      guard.canActivate(contextFor({ user, actorUser })),
    ).rejects.toThrow(ForbiddenException)
  })

  it('refuses an M2M token, which carries no session user', async () => {
    await expect(
      guard.canActivate(
        contextFor({ m2mToken: {} as IncomingRequest['m2mToken'] }),
      ),
    ).rejects.toThrow(ForbiddenException)
  })

  it('refuses an agent token', async () => {
    await expect(
      guard.canActivate(contextFor({ user: staff, agentToken: true })),
    ).rejects.toThrow(ForbiddenException)
  })

  it('refuses when the flag is off', async () => {
    isFeatureEnabled.mockResolvedValue(false)
    await expect(
      guard.canActivate(contextFor({ user: staff })),
    ).rejects.toThrow(ForbiddenException)
  })
})
