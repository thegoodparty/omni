import { describe, expect, it } from 'vitest'
import { peerlyIdentityUseCaseResponseBodySchema } from './peerlyIdentity.schema'

const pendingUseCase = {
  identity_id: 'id-1',
  account_id: 'acct-1',
  usecase: 'POLITICAL',
  submitted: 1,
  activated: 0,
}

describe('peerlyIdentityUseCaseResponseBodySchema', () => {
  it.each([
    ['null', { ...pendingUseCase, tcr_campaign_id: null }],
    ['absent', pendingUseCase],
    ['assigned', { ...pendingUseCase, tcr_campaign_id: 'C123' }],
  ])('accepts a use case whose tcr_campaign_id is %s', (_label, useCase) => {
    expect(
      peerlyIdentityUseCaseResponseBodySchema.safeParse([useCase]).success,
    ).toBe(true)
  })

  it('still rejects a non-string tcr_campaign_id', () => {
    expect(
      peerlyIdentityUseCaseResponseBodySchema.safeParse([
        { ...pendingUseCase, tcr_campaign_id: 5 },
      ]).success,
    ).toBe(false)
  })
})
