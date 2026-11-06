import { describe, expect, it } from 'vitest'
import { requireAgent } from '../agents'
import { DEFAULT_JUDGE_CONFIG } from '../config'
import { estimateAgent } from '../planCost'
import { priceAgentSet } from './guardPricing'

describe('priceAgentSet', () => {
  it('is 0 for an empty agent set', () => {
    expect(priceAgentSet([])).toEqual({ cents: 0, perAgent: {} })
  })

  it('sums each agent at the same price estimateAgent gives it directly', () => {
    const expected =
      estimateAgent(requireAgent('chief_of_staff'), DEFAULT_JUDGE_CONFIG)
        .cents +
      estimateAgent(requireAgent('campaign_assistant'), DEFAULT_JUDGE_CONFIG)
        .cents

    const result = priceAgentSet(['chief_of_staff', 'campaign_assistant'])

    expect(result.cents).toBe(expected)
    expect(Object.keys(result.perAgent)).toEqual([
      'chief_of_staff',
      'campaign_assistant',
    ])
  })

  it('throws for an agent id outside the registry', () => {
    expect(() => priceAgentSet(['not_a_real_agent'])).toThrow()
  })
})
