import { describe, expect, it } from 'vitest'
import {
  approve10DLCBrandResponseBodySchema,
  peerly10DLCBrandSubmitResponseBodySchema,
} from './peerlyTdlc.schema'

// Peerly documents both submit and approve as returning the brand info.
const brandInfo = {
  street: '1 Main St',
  phone: '+15125550123',
  legal_entity_type: 'NON_PROFIT',
  account_id: 'acc',
  companyName: 'Friends of Test',
  country: 'US',
  postalCode: '78701',
  entityType: 'NON_PROFIT',
  base_account_id: 'acc',
  email: 'info@example.com',
  state: 'TX',
  vertical: 'POLITICAL',
  is_political: true,
  website: 'example.com',
  ein: '12-3456789',
  sample1: 's1',
  displayName: 'Friends of Test',
  status: 'waiting_to_finalize',
  city: 'Austin',
  usecase: 'POLITICAL',
  sample2: 's2',
  campaign_verify_token: 'cv',
}

describe('peerly10DLCBrandSubmitResponseBodySchema', () => {
  it('accepts the brand info, which carries no submission_key', () => {
    expect(
      peerly10DLCBrandSubmitResponseBodySchema.safeParse(brandInfo).success,
    ).toBe(true)
  })

  it('still rejects a non-string submission_key', () => {
    expect(
      peerly10DLCBrandSubmitResponseBodySchema.safeParse({ submission_key: 1 })
        .success,
    ).toBe(false)
  })
})

describe('approve10DLCBrandResponseBodySchema', () => {
  it('accepts the brand info without usecases or entity_type', () => {
    expect(
      approve10DLCBrandResponseBodySchema.safeParse(brandInfo).success,
    ).toBe(true)
  })

  it('accepts a brand whose display fields are null', () => {
    expect(
      approve10DLCBrandResponseBodySchema.safeParse({
        ...brandInfo,
        country: null,
        sample2: null,
      }).success,
    ).toBe(true)
  })

  it('rejects a field of the wrong type', () => {
    expect(
      approve10DLCBrandResponseBodySchema.safeParse({
        ...brandInfo,
        is_political: 'yes',
      }).success,
    ).toBe(false)
  })

  it('rejects a body that is not an object', () => {
    expect(approve10DLCBrandResponseBodySchema.safeParse('ok').success).toBe(
      false,
    )
  })
})
