import { afterEach, describe, expect, it, vi } from 'vitest'

// VENDOR_MODE and ENABLE_DOMAIN_PURCHASE are read at module load, so each
// case stubs the env and imports a fresh copy of the service.
const shouldEnable = async (vendorMode: string, enableEnv: string) => {
  vi.resetModules()
  vi.stubEnv('VENDOR_MODE', vendorMode)
  vi.stubEnv('ENABLE_DOMAIN_PURCHASE', enableEnv)
  const { DomainsService } = await import('./domains.service.js')
  return DomainsService.prototype.shouldEnableDomainPurchase.call({})
}

describe('DomainsService.shouldEnableDomainPurchase', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('is true in mock mode without ENABLE_DOMAIN_PURCHASE', async () => {
    expect(await shouldEnable('mock', '')).toBe(true)
  })

  it('is false in live mode with the env var unset', async () => {
    expect(await shouldEnable('live', '')).toBe(false)
  })

  it('is true in live mode when the env var is true', async () => {
    expect(await shouldEnable('live', 'true')).toBe(true)
  })
})
