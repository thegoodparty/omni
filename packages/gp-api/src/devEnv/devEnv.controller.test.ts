import { NotFoundException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DevEnvController } from './devEnv.controller'
import { DevEnvRequest } from './devEnv.types'
import { DevEnvService } from './services/devEnv.service'

// IS_NON_PROD_DEPLOY is a module-level constant read inside the handler. Mock
// the util so the gate is toggleable per-test via a getter. Default true
// because the unit-test env has no OTEL_SERVICE_ENVIRONMENT (so the real
// value is false) yet the happy path needs a non-prod deploy.
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

describe('DevEnvController', () => {
  let controller: DevEnvController
  let service: { getBundles: ReturnType<typeof vi.fn> }
  let req: DevEnvRequest

  beforeEach(() => {
    envNonProd.value = true
    service = { getBundles: vi.fn().mockResolvedValue({ bundles: [] }) }
    controller = new DevEnvController(service as unknown as DevEnvService)
    req = { githubLogin: 'octocat' } as unknown as DevEnvRequest
  })

  it('vends for the login the guard verified', async () => {
    await expect(controller.getBundle(req, {})).resolves.toEqual({
      bundles: [],
    })
    expect(service.getBundles).toHaveBeenCalledWith(undefined, 'octocat')
  })

  it('passes a package filter through', async () => {
    await controller.getBundle(req, { packages: ['gp-api'] })

    expect(service.getBundles).toHaveBeenCalledWith(['gp-api'], 'octocat')
  })

  // false models prod or a misconfigured/absent OTEL_SERVICE_ENVIRONMENT,
  // where the fail-closed gate must 404 rather than silently ungate. The gate
  // throws before any async work, hence the synchronous assertion.
  it('404s outside a known non-prod deploy', () => {
    envNonProd.value = false

    expect(() => controller.getBundle(req, {})).toThrow(NotFoundException)
    expect(service.getBundles).not.toHaveBeenCalled()
  })
})
