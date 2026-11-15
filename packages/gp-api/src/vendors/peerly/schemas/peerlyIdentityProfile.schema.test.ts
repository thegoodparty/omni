import { describe, expect, it } from 'vitest'
import { peerlyIdentityProfileResponseBodySchema } from './peerlyIdentity.schema'

// The documented getProfile example, with a brand and one campaign.
const profile = {
  account_id: 'acc',
  base_account_id: 'acc',
  campaignVerifyToken: null,
  campaigns: {
    abc: {
      autoRenewal: 1,
      description: '',
      embeddedLink: 1,
      embeddedPhone: 1,
      sample1: '',
      subscriberOptin: 1,
      subscriberOptout: 1,
      usecase: 'POLITICAL',
      vertical: 'Example',
    },
  },
  city: 'c',
  companyName: 'co',
  country: null,
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
  vertical: 'POLITICAL',
  website: 'w',
  will_send_over_2k: false,
}

const parse = (body: object) =>
  peerlyIdentityProfileResponseBodySchema.safeParse(body).success

describe('peerlyIdentityProfileResponseBodySchema', () => {
  it('accepts the documented profile', () => {
    expect(parse({ link: 'l', profile })).toBe(true)
  })

  it('accepts a profile with only the status gp-api reads', () => {
    expect(parse({ link: 'l', profile: { status: 'pending' } })).toBe(true)
  })

  it.each([
    ['an empty list', []],
    ['null', null],
  ])('accepts campaigns as %s before a brand exists', (_label, campaigns) => {
    expect(
      parse({ link: 'l', profile: { ...profile, campaigns, usecase: null } }),
    ).toBe(true)
  })

  it('accepts a response with no profile', () => {
    expect(parse({ link: 'l' })).toBe(true)
  })

  it('rejects a profile without a status', () => {
    expect(
      parse({ link: 'l', profile: { ...profile, status: undefined } }),
    ).toBe(false)
  })

  it.each([
    ['status', { status: 1 }],
    ['vertical', { vertical: true }],
  ])('rejects a non-string %s', (_label, override) => {
    expect(parse({ link: 'l', profile: { ...profile, ...override } })).toBe(
      false,
    )
  })

  it('rejects a body without the registration link', () => {
    expect(parse({ profile })).toBe(false)
  })
})
