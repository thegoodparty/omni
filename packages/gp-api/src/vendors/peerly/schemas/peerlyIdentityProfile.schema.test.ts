import { describe, expect, it } from 'vitest'
import { peerlyIdentityProfileResponseBodySchema } from './peerlyIdentity.schema'

const profile = {
  account_id: 'acc',
  base_account_id: 'acc',
  campaigns: {
    abc: {
      autoRenewal: 1,
      description: 'd',
      embeddedLink: 0,
      embeddedPhone: 0,
      sample1: 's',
      subscriberOptin: 1,
      subscriberOptout: 1,
      usecase: 'POLITICAL',
    },
  },
  city: 'c',
  companyName: 'co',
  country: 'US',
  displayName: 'dn',
  ein: '1',
  email: 'e@x.com',
  entityType: 'NON_PROFIT',
  is_political: true,
  legal_entity_type: 'NON_PROFIT',
  phone: '1',
  postalCode: '1',
  state: 'CA',
  status: 'pending',
  street: 's',
  usecase: 'POLITICAL',
  website: 'w',
}

describe('peerlyIdentityProfileResponseBodySchema', () => {
  it('accepts a profile without campaignVerifyToken, usecases, will_send_over_2k or campaign vertical', () => {
    const result = peerlyIdentityProfileResponseBodySchema.safeParse({
      link: 'l',
      profile,
    })
    expect(result.success).toBe(true)
  })

  it('still rejects a profile missing a required field', () => {
    const { ein: _ein, ...rest } = profile
    const result = peerlyIdentityProfileResponseBodySchema.safeParse({
      link: 'l',
      profile: rest,
    })
    expect(result.success).toBe(false)
  })
})
