import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'

// The env is captured at module load, so each case stubs the env and
// re-imports a fresh copy of the module.
const loadConfig = async () => {
  vi.resetModules()
  const { CallfireBaseConfig } = await import('./callfireBaseConfig.js')
  return new CallfireBaseConfig(createMockLogger())
}

describe('CallfireBaseConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('boots without credentials and throws only on first use', async () => {
    vi.stubEnv('CALLFIRE_LOGIN', '')
    vi.stubEnv('CALLFIRE_PASSWORD', '')
    const config = await loadConfig()
    expect(() => config.apiLogin).toThrow('Missing CALLFIRE_LOGIN config')
    expect(() => config.apiPassword).toThrow('Missing CALLFIRE_PASSWORD config')
  })

  it('returns the credentials when set', async () => {
    vi.stubEnv('CALLFIRE_LOGIN', 'the-login')
    vi.stubEnv('CALLFIRE_PASSWORD', 'the-password')
    const config = await loadConfig()
    expect(config.apiLogin).toBe('the-login')
    expect(config.apiPassword).toBe('the-password')
  })
})
