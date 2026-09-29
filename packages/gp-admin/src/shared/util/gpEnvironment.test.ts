import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  GP_ENVIRONMENT,
  getEnvironmentConfig,
  isEnvironmentServed,
  resolveEnvironment,
  servedEnvironments,
} from './gpEnvironment'

const DEV_ORG = 'org_dev_123'
const PROD_ORG = 'org_prod_456'
const DEV_SECRET = 'ak_dev_secret'
const PROD_SECRET = 'ak_prod_secret'

beforeEach(() => {
  vi.stubEnv('GP_ORG_ID_DEV', DEV_ORG)
  vi.stubEnv('GP_ORG_ID_PROD', PROD_ORG)
  vi.stubEnv('GP_DEV_API_DOMAIN', 'dev-api.goodparty.org')
  vi.stubEnv('GP_PROD_API_DOMAIN', 'api.goodparty.org')
  vi.stubEnv('GP_DEV_MACHINE_SECRET', DEV_SECRET)
  vi.stubEnv('GP_PROD_MACHINE_SECRET', PROD_SECRET)
  vi.stubEnv('GP_API_PROTOCOL', 'https')
  vi.stubEnv('GP_API_PORT', '')
  vi.stubEnv('GP_API_ROOT_PATH', '/v1')
  vi.stubEnv('GP_ADMIN_ENVIRONMENTS', undefined)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

// A deployment that leaves GP_ADMIN_ENVIRONMENTS unset behaves exactly as it
// did before the allow-list existed.
describe('with no allow-list set', () => {
  it('serves every known environment', () => {
    expect(servedEnvironments()).toEqual([
      GP_ENVIRONMENT.DEV,
      GP_ENVIRONMENT.PROD,
    ])
  })

  it('resolves both organizations', () => {
    expect(resolveEnvironment(DEV_ORG)).toBe(GP_ENVIRONMENT.DEV)
    expect(resolveEnvironment(PROD_ORG)).toBe(GP_ENVIRONMENT.PROD)
  })

  it('builds a config for both environments', () => {
    expect(getEnvironmentConfig(GP_ENVIRONMENT.DEV).m2mSecret).toBe(DEV_SECRET)
    expect(getEnvironmentConfig(GP_ENVIRONMENT.PROD).m2mSecret).toBe(
      PROD_SECRET
    )
  })
})

describe('with a single-environment allow-list', () => {
  beforeEach(() => {
    vi.stubEnv('GP_ADMIN_ENVIRONMENTS', 'dev')
  })

  it('reports only that environment as served', () => {
    expect(servedEnvironments()).toEqual([GP_ENVIRONMENT.DEV])
    expect(isEnvironmentServed(GP_ENVIRONMENT.DEV)).toBe(true)
    expect(isEnvironmentServed(GP_ENVIRONMENT.PROD)).toBe(false)
  })

  it('still resolves the served organization', () => {
    expect(resolveEnvironment(DEV_ORG)).toBe(GP_ENVIRONMENT.DEV)
  })

  it('refuses the organization it does not serve', () => {
    expect(() => resolveEnvironment(PROD_ORG)).toThrow(
      /does not serve the prod environment/
    )
  })

  it('refuses a config for the environment it does not serve', () => {
    expect(() => getEnvironmentConfig(GP_ENVIRONMENT.PROD)).toThrow(
      /does not serve the prod environment/
    )
  })

  it('does not name the secret it refused to hand out', () => {
    let message = ''
    try {
      getEnvironmentConfig(GP_ENVIRONMENT.PROD)
    } catch (err) {
      message = err instanceof Error ? err.message : String(err)
    }

    expect(message).toContain('does not serve the prod environment')
    expect(message).not.toContain(PROD_SECRET)
  })

  it('reports its own missing secret rather than reaching for another', () => {
    vi.stubEnv('GP_DEV_MACHINE_SECRET', '')

    expect(() => getEnvironmentConfig(GP_ENVIRONMENT.DEV)).toThrow(
      'GP_DEV_MACHINE_SECRET is not set'
    )
  })

  it('tolerates whitespace and casing', () => {
    vi.stubEnv('GP_ADMIN_ENVIRONMENTS', ' PROD , ')

    expect(servedEnvironments()).toEqual([GP_ENVIRONMENT.PROD])
    expect(() => resolveEnvironment(DEV_ORG)).toThrow(
      /does not serve the dev environment/
    )
  })
})

describe('with a malformed allow-list', () => {
  it('refuses an unknown environment name', () => {
    vi.stubEnv('GP_ADMIN_ENVIRONMENTS', 'dev,staging')

    expect(() => servedEnvironments()).toThrow(
      'GP_ADMIN_ENVIRONMENTS names unknown environments: staging'
    )
  })

  it('refuses a list that names nothing', () => {
    vi.stubEnv('GP_ADMIN_ENVIRONMENTS', ',,')

    expect(() => servedEnvironments()).toThrow(
      'GP_ADMIN_ENVIRONMENTS names no environments'
    )
  })
})

describe('resolveEnvironment', () => {
  it('rejects an organization it has no mapping for', () => {
    expect(() => resolveEnvironment('org_unknown')).toThrow(
      'Unknown organization ID: org_unknown'
    )
  })
})
