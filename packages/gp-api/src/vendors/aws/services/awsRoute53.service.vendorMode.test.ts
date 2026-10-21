import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'

const clientOptions = vi.hoisted(() => ({
  last: undefined as { endpoint?: string } | undefined,
}))
vi.mock('@aws-sdk/client-route-53-domains', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@aws-sdk/client-route-53-domains')>()
  return {
    ...actual,
    Route53DomainsClient: class {
      constructor(options: { endpoint?: string }) {
        clientOptions.last = options
      }
    },
  }
})

const loadOptions = async (vendorMode: string) => {
  vi.resetModules()
  vi.stubEnv('VENDOR_MODE', vendorMode)
  const { AwsRoute53Service } = await import('./awsRoute53.service.js')
  new AwsRoute53Service(createMockLogger())
  return clientOptions.last
}

describe('Route53 domains client endpoint', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('points at the Route53 mock in mock mode', async () => {
    expect((await loadOptions('mock'))?.endpoint).toMatch(
      /\/v1\/vendor-mocks\/route53$/,
    )
  })

  it('leaves the endpoint unset in live mode so the SDK resolves it', async () => {
    expect(await loadOptions('live')).not.toHaveProperty('endpoint')
  })
})
