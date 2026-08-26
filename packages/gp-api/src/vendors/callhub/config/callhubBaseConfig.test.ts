import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'

// The env is captured at module load, so each case stubs the env and
// re-imports a fresh copy of the module.
const loadConfig = async () => {
  vi.resetModules()
  const { CallhubBaseConfig } = await import('./callhubBaseConfig.js')
  return new CallhubBaseConfig(createMockLogger())
}

describe('CallhubBaseConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('boots without CALLHUB_API_KEY and throws only on first use', async () => {
    vi.stubEnv('CALLHUB_API_KEY', '')
    const config = await loadConfig()
    expect(() => config.apiKey).toThrow('Missing CALLHUB_API_KEY config')
  })

  it('returns the key when set', async () => {
    vi.stubEnv('CALLHUB_API_KEY', 'the-key')
    const config = await loadConfig()
    expect(config.apiKey).toBe('the-key')
  })
})
