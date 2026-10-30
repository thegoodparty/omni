import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SdkError } from '@/shared/gpApi'
import { gpAction } from './gpClient.util'
import { GP_API_ACCESS_DENIED_DIGEST } from './actionFailure.util'

vi.mock('@clerk/nextjs/server', () => ({
  auth: async () => ({ orgId: 'org_prod' }),
}))

vi.mock('@/shared/util/gpEnvironment', () => ({
  resolveEnvironment: () => 'prod',
  getEnvironmentConfig: () => ({}),
}))

vi.mock('@/shared/gpApi', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/shared/gpApi')>()
  return {
    ...original,
    GoodPartyClient: { create: vi.fn(async () => ({})) },
  }
})

describe('gpAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each([401, 403])(
    'tags a %i from gp-api with the access-denied digest',
    async (status) => {
      const rejection = gpAction(async () => {
        throw new SdkError(status, 'Unauthorized')
      })

      await expect(rejection).rejects.toBeInstanceOf(SdkError)
      await expect(rejection).rejects.toMatchObject({
        status,
        digest: GP_API_ACCESS_DENIED_DIGEST,
      })
    }
  )

  it('leaves other gp-api errors untagged', async () => {
    const rejection = gpAction(async () => {
      throw new SdkError(500, 'Internal Server Error')
    })

    await expect(rejection).rejects.toSatisfy(
      (error: unknown) => !(error instanceof Object && 'digest' in error)
    )
  })
})
