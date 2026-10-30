import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { GP_ENVIRONMENT, getEnvironmentConfig } from './gpEnvironment'

describe('getEnvironmentConfig', () => {
  beforeEach(() => {
    vi.stubEnv('GP_API_PROTOCOL', 'https')
    vi.stubEnv('GP_API_PORT', '')
    vi.stubEnv('GP_API_ROOT_PATH', '/v1')
    vi.stubEnv('GP_DEV_API_DOMAIN', 'gp-api-dev.test')
    vi.stubEnv('GP_DEV_MACHINE_SECRET', 'ak_dev')
    vi.stubEnv('GP_API_AUTH_MODE', '')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('defaults to clerk when GP_API_AUTH_MODE is unset', () => {
    expect(getEnvironmentConfig(GP_ENVIRONMENT.DEV)).toEqual({
      gpApiRootUrl: 'https://gp-api-dev.test/v1',
      authMode: 'clerk',
      m2mSecret: 'ak_dev',
    })
  })

  it('requires the machine secret in clerk mode', () => {
    vi.stubEnv('GP_API_AUTH_MODE', 'clerk')
    vi.stubEnv('GP_DEV_MACHINE_SECRET', '')

    expect(() => getEnvironmentConfig(GP_ENVIRONMENT.DEV)).toThrow(
      'GP_DEV_MACHINE_SECRET is not set'
    )
  })

  it('does not require the machine secret in oidc mode', () => {
    vi.stubEnv('GP_API_AUTH_MODE', 'oidc')
    vi.stubEnv('GP_DEV_MACHINE_SECRET', '')

    expect(getEnvironmentConfig(GP_ENVIRONMENT.DEV)).toMatchObject({
      authMode: 'oidc',
      m2mSecret: undefined,
    })
  })

  it('rejects any GP_API_AUTH_MODE other than clerk or oidc', () => {
    vi.stubEnv('GP_API_AUTH_MODE', 'vercel')

    expect(() => getEnvironmentConfig(GP_ENVIRONMENT.DEV)).toThrow(
      'GP_API_AUTH_MODE must be "clerk" or "oidc", got "vercel"'
    )
  })
})
