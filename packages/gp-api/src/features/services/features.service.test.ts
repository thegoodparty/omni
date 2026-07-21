import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import type { User } from '@/generated/prisma'
import { FeaturesService } from './features.service'

const fetchV2 = vi.hoisted(() => vi.fn())

vi.mock('@amplitude/experiment-node-server', () => ({
  Experiment: {
    initializeRemote: () => ({ fetchV2 }),
  },
}))

const user = {
  id: 123,
  email: 'official@example.org',
  firstName: 'Renee',
  lastName: 'Carter',
} as unknown as User

const buildService = () =>
  new FeaturesService(
    { findUniqueOrThrow: vi.fn().mockResolvedValue(user) } as never,
    createMockLogger(),
  )

// .env.test carries the .env.example placeholder key, so these tests run in
// the same placeholder mode as CI and local dev boxes.
describe('FeaturesService with the placeholder Amplitude key', () => {
  beforeEach(() => {
    fetchV2.mockReset()
  })

  it('resolves isFeatureEnabled without a network round-trip', async () => {
    const enabled = await buildService().isFeatureEnabled({
      user,
      feature: 'serve-ordinances',
    })

    // The placeholder key always 401s upstream; the doomed fetch used to
    // cost real seconds per gated request and pushed CI tests into their
    // 5s timeout.
    expect(enabled).toBe(true)
    expect(fetchV2).not.toHaveBeenCalled()
  })

  it('resolves getAllVariants without a network round-trip', async () => {
    const variants = await buildService().getAllVariants(user)

    expect(variants).toEqual({})
    expect(fetchV2).not.toHaveBeenCalled()
  })
})
