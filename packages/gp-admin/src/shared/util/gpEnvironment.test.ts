import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { GP_ENVIRONMENT, getEnvironmentConfig } from './gpEnvironment'

describe('getEnvironmentConfig', () => {
  beforeEach(() => {
    vi.stubEnv('GP_API_PROTOCOL', 'https')
    vi.stubEnv('GP_API_PORT', '')
    vi.stubEnv('GP_API_ROOT_PATH', '/v1')
    vi.stubEnv('GP_DEV_API_DOMAIN', 'gp-api-dev.test')
    vi.stubEnv('GP_PROD_API_DOMAIN', 'gp-api.test')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('builds the gp-api root URL for each environment', () => {
    expect(getEnvironmentConfig(GP_ENVIRONMENT.DEV)).toEqual({
      gpApiRootUrl: 'https://gp-api-dev.test/v1',
    })
    expect(getEnvironmentConfig(GP_ENVIRONMENT.PROD)).toEqual({
      gpApiRootUrl: 'https://gp-api.test/v1',
    })
  })

  it('requires the environment API domain', () => {
    vi.stubEnv('GP_PROD_API_DOMAIN', '')

    expect(() => getEnvironmentConfig(GP_ENVIRONMENT.PROD)).toThrow(
      'GP_PROD_API_DOMAIN is not set'
    )
  })
})
