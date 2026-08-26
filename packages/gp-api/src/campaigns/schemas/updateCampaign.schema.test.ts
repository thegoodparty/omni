import { describe, expect, it } from 'vitest'
import { updateCampaignBodySchema } from './updateCampaign.schema'

describe('updateCampaignBodySchema', () => {
  it('accepts legitimate campaign details', () => {
    const result = updateCampaignBodySchema.parse({
      details: { state: 'CA', city: 'Los Angeles' },
    })

    expect(result.details).toEqual({
      state: 'CA',
      city: 'Los Angeles',
    })
  })

  it.each([
    'subscriptionId',
    'subscriptionCanceledAt',
    'subscriptionCancelAt',
    'endOfElectionSubscriptionCanceled',
    'isProUpdatedAt',
    'proUpgradeSlackNotifiedAt',
  ])('strips Stripe-managed field "%s" from details', (field) => {
    const result = updateCampaignBodySchema.parse({
      details: { state: 'CA', [field]: 'injected' },
    })

    expect(result.details).not.toHaveProperty(field)
    expect(result.details).toHaveProperty('state', 'CA')
  })

  it('accepts the pro-upgrade wizard fields so the EIN and status steps persist', () => {
    const result = updateCampaignBodySchema.parse({
      details: {
        einNumber: '23-1234567',
        validatedEin: true,
        hasFiledForRace: true,
      },
    })

    expect(result.details).toEqual({
      einNumber: '23-1234567',
      validatedEin: true,
      hasFiledForRace: true,
    })
  })

  it.each(['on-ballot', 'qualified-not-filed', 'considering', 'testing'])(
    'persists onboarding ballotStatus "%s"',
    (ballotStatus) => {
      const result = updateCampaignBodySchema.parse({
        details: { ballotStatus },
      })

      expect(result.details).toHaveProperty('ballotStatus', ballotStatus)
    },
  )

  it('rejects an unknown ballotStatus', () => {
    expect(() =>
      updateCampaignBodySchema.parse({ details: { ballotStatus: 'maybe' } }),
    ).toThrow()
  })

  it('rejects an einNumber that is not in XX-XXXXXXX format', () => {
    expect(() =>
      updateCampaignBodySchema.parse({
        details: { einNumber: '231234567' },
      }),
    ).toThrow()
  })

  it.each(['won', 'lost'])(
    'accepts top-level primaryResult "%s" so the election result persists',
    (primaryResult) => {
      const result = updateCampaignBodySchema.parse({ primaryResult })

      expect(result).toHaveProperty('primaryResult', primaryResult)
    },
  )

  it('accepts null primaryResult so a recorded result can be cleared', () => {
    const result = updateCampaignBodySchema.parse({ primaryResult: null })

    expect(result.primaryResult).toBeNull()
  })

  it('rejects an invalid primaryResult value', () => {
    expect(() =>
      updateCampaignBodySchema.parse({ primaryResult: 'maybe' }),
    ).toThrow()
  })

  it('strips primaryResult from details (it is a top-level column)', () => {
    const result = updateCampaignBodySchema.parse({
      details: { state: 'CA', primaryResult: 'won' },
    })

    expect(result.details).not.toHaveProperty('primaryResult')
  })

  it.each([true, false])(
    'persists details.wonGeneral "%s" so the election result is recorded',
    (wonGeneral) => {
      const result = updateCampaignBodySchema.parse({
        details: { wonGeneral },
      })

      expect(result.details).toHaveProperty('wonGeneral', wonGeneral)
    },
  )
})
