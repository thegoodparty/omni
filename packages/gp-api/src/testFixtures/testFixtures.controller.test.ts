import { NotFoundException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TestFixturesController } from './testFixtures.controller'
import { TestFixturesService } from './services/testFixtures.service'

// IS_NON_PROD_DEPLOY is a module-level constant read inside every handler.
// Mock the util so the gate is toggleable per-test via a getter. Default true
// because the unit-test env has no OTEL_SERVICE_ENVIRONMENT (so the real value
// is false) yet the happy-path cases need a non-prod deploy; other exports pass
// through untouched.
const { envNonProd } = vi.hoisted(() => ({ envNonProd: { value: true } }))
vi.mock('@/shared/util/appEnvironment.util', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/shared/util/appEnvironment.util')>()
  return {
    ...actual,
    get IS_NON_PROD_DEPLOY() {
      return envNonProd.value
    },
  }
})

describe('TestFixturesController', () => {
  let controller: TestFixturesController
  let service: {
    createFixtureUser: ReturnType<typeof vi.fn>
    deleteFixtureUsers: ReturnType<typeof vi.fn>
    mintFixtureSession: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    envNonProd.value = true
    service = {
      createFixtureUser: vi.fn().mockResolvedValue({ userId: 1 }),
      deleteFixtureUsers: vi.fn().mockResolvedValue({ deleted: [] }),
      mintFixtureSession: vi.fn().mockResolvedValue({ userId: 1 }),
    }
    controller = new TestFixturesController(
      service as unknown as TestFixturesService,
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

  // false models prod or a misconfigured/absent OTEL_SERVICE_ENVIRONMENT,
  // where the fail-closed gate must 404 rather than silently ungate. The gate
  // throws before any async work, hence the synchronous assertions.
  it('404s every endpoint outside a known non-prod deploy', () => {
    envNonProd.value = false

    expect(() => controller.createUser({ state: 'free-win' })).toThrow(
      NotFoundException,
    )
    expect(() => controller.deleteUsers({ userIds: [1] })).toThrow(
      NotFoundException,
    )
    expect(() => controller.mintSession(1, {})).toThrow(NotFoundException)
    expect(service.createFixtureUser).not.toHaveBeenCalled()
    expect(service.deleteFixtureUsers).not.toHaveBeenCalled()
    expect(service.mintFixtureSession).not.toHaveBeenCalled()
  })
})
