import { afterEach, describe, expect, it, vi } from 'vitest'

const sdkOptions = vi.hoisted(() => ({ last: undefined as unknown }))
vi.mock('@vercel/sdk', () => ({
  Vercel: class {
    constructor(options: unknown) {
      sdkOptions.last = options
    }
  },
}))

// The client is built at module load, so each case stubs the env and imports
// a fresh copy of the service.
const loadOptions = async (vendorMode: string, token: string) => {
  vi.resetModules()
  vi.stubEnv('VENDOR_MODE', vendorMode)
  vi.stubEnv('VERCEL_TOKEN', token)
  vi.stubEnv('VERCEL_PROJECT_ID', token)
  sdkOptions.last = undefined
  await import('./vercel.service.js')
  return sdkOptions.last
}

describe('Vercel client server URL', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('points at the Vercel mock in mock mode, even with no Vercel keys', async () => {
    expect(await loadOptions('mock', '')).toMatchObject({
      serverURL: expect.stringMatching(/\/v1\/vendor-mocks\/vercel$/),
    })
  })

  it('uses the real Vercel host in live mode', async () => {
    expect(await loadOptions('live', 'real-token')).toMatchObject({
      serverURL: 'https://api.vercel.com',
      bearerToken: 'real-token',
    })
  })

  it('builds no client in live mode when the keys are missing', async () => {
    expect(await loadOptions('live', '')).toBeUndefined()
  })
})
