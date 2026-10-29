import { NotFoundException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TestFixturesController } from './testFixtures.controller'
import { ActivitySeedService } from './services/activitySeed.service'
import { TestFixturesService } from './services/testFixtures.service'
import {
  appEnvOverrides,
  useAppEnvOverrides,
} from '@/shared/test-utils/appEnvOverrides'

// IS_NON_PROD_DEPLOY is a module-level constant read inside every handler.
// Default true because the unit-test env has no OTEL_SERVICE_ENVIRONMENT (so
// the real value is false) yet the happy-path cases need a non-prod deploy.
useAppEnvOverrides({ IS_NON_PROD_DEPLOY: true })

describe('TestFixturesController', () => {
  let controller: TestFixturesController
  let service: {
    createFixtureUser: ReturnType<typeof vi.fn>
    deleteFixtureUsers: ReturnType<typeof vi.fn>
    mintFixtureSession: ReturnType<typeof vi.fn>
    runJob: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    appEnvOverrides.IS_NON_PROD_DEPLOY = true
    service = {
      createFixtureUser: vi.fn().mockResolvedValue({ userId: 1 }),
      deleteFixtureUsers: vi.fn().mockResolvedValue({ deleted: [] }),
      mintFixtureSession: vi.fn().mockResolvedValue({ userId: 1 }),
      runJob: vi.fn().mockResolvedValue({
        ranAt: '2026-10-19T00:00:00.000Z',
        durationMs: 5,
      }),
    }
    controller = new TestFixturesController(
      service as unknown as TestFixturesService,
      {} as ActivitySeedService,
    )
  })

  it('delegates fixture creation on a non-prod deploy', async () => {
    const body = { state: 'free-win' as const }

    await expect(controller.createUser(body)).resolves.toEqual({ userId: 1 })
    expect(service.createFixtureUser).toHaveBeenCalledWith(body)
  })

  it('delegates deletion on a non-prod deploy', async () => {
    const body = { userIds: [42] }

    await expect(controller.deleteUsers(body)).resolves.toEqual({
      deleted: [],
    })
    expect(service.deleteFixtureUsers).toHaveBeenCalledWith(body)
  })

  it('delegates session minting on a non-prod deploy', async () => {
    await expect(controller.mintSession(42, {})).resolves.toEqual({
      userId: 1,
    })
    expect(service.mintFixtureSession).toHaveBeenCalledWith(42, {})
  })

  it.each([
    'robocall.staging',
    'robocall.send',
    'robocall.completion',
    'robocall.capture',
    'robocall.callhubCleanup',
  ])('delegates runJob(%s) on a non-prod deploy', async (name) => {
    const result = await controller.runJob(name)
    expect(result).toEqual({
      ranAt: '2026-10-19T00:00:00.000Z',
      durationMs: 5,
    })
    expect(service.runJob).toHaveBeenCalledWith(name)
  })

  // false models prod or a misconfigured/absent OTEL_SERVICE_ENVIRONMENT,
  // where the fail-closed gate must 404 rather than silently ungate. The gate
  // throws before any async work, hence the synchronous assertions.
  it('404s every endpoint outside a known non-prod deploy', () => {
    appEnvOverrides.IS_NON_PROD_DEPLOY = false

    expect(() => controller.createUser({ state: 'free-win' })).toThrow(
      NotFoundException,
    )
    expect(() => controller.deleteUsers({ userIds: [1] })).toThrow(
      NotFoundException,
    )
    expect(() => controller.mintSession(1, {})).toThrow(NotFoundException)
    expect(() => controller.runJob('robocall.staging')).toThrow(
      NotFoundException,
    )
    expect(service.createFixtureUser).not.toHaveBeenCalled()
    expect(service.deleteFixtureUsers).not.toHaveBeenCalled()
    expect(service.mintFixtureSession).not.toHaveBeenCalled()
    expect(service.runJob).not.toHaveBeenCalled()
  })
})
