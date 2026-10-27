import { describe, expect, it } from 'vitest'
import {
  peerlyGetIdentitiesResponseBodySchema,
  peerlyIdentityCreateResponseBodySchema,
  peerlyIdentityUseCaseResponseBodySchema,
} from './peerlyIdentity.schema'

const pendingUseCase = {
  identity_id: 'id-1',
  account_id: 'acct-1',
  usecase: 'POLITICAL',
  submitted: 1,
  activated: 0,
}

// The documented listByAccount items: no account_id, and an unvetted
// identity has null vetting_expire_date and tcr_identity_status.
const vettedIdentity = {
  identity_name: 'First Identity',
  vetting_expire_date: '2027-01-31',
  identity_id: '88880045',
  tcr_identity_status: 'VERIFIED',
  start_date: '2021-04-23',
  usecases: ['POLITICAL'],
}
const unvettedIdentity = {
  identity_name: 'Second Identity',
  vetting_expire_date: null,
  identity_id: '88880046',
  tcr_identity_status: null,
  start_date: '2021-04-23',
}

describe('peerlyGetIdentitiesResponseBodySchema', () => {
  it('accepts identities without account_id and with null vetting dates', () => {
    expect(
      peerlyGetIdentitiesResponseBodySchema.safeParse({
        identities: [vettedIdentity, unvettedIdentity],
      }).success,
    ).toBe(true)
  })

  it.each([
    ['a missing identity_id', { identity_name: 'n' }],
    ['a numeric identity_id', { identity_id: 1, identity_name: 'n' }],
    ['a missing identity_name', { identity_id: '1' }],
  ])('rejects an identity with %s', (_label, identity) => {
    expect(
      peerlyGetIdentitiesResponseBodySchema.safeParse({
        identities: [identity],
      }).success,
    ).toBe(false)
  })
})

describe('peerlyIdentityCreateResponseBodySchema', () => {
  it('accepts the documented created identity, which has no account_id', () => {
    expect(
      peerlyIdentityCreateResponseBodySchema.safeParse({
        Data: {
          identity_id: '12345678',
          identity_name: 'API Test Identity',
          start_date: '2016-04-20',
          displayName: 'Test Identity',
          usecases: ['POLITICAL'],
          tcr_identity_status: 'ACTIVE',
        },
      }).success,
    ).toBe(true)
  })
})

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

  it.each([
    ['a missing usecase', { activated: 1 }],
    ['a boolean activated', { usecase: 'POLITICAL', activated: true }],
  ])('rejects a use case with %s', (_label, useCase) => {
    expect(
      peerlyIdentityUseCaseResponseBodySchema.safeParse([useCase]).success,
    ).toBe(false)
  })
})
