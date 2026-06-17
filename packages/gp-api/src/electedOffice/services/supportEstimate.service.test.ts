import { describe, expect, it } from 'vitest'
import { SupportEstimateSchema } from '@goodparty_org/contracts'
import { SupportEstimateService } from './supportEstimate.service'

describe('SupportEstimateService', () => {
  const service = new SupportEstimateService()

  it('returns the interim estimate matching the contract shape', () => {
    const result = service.getSupportEstimate('elected-office-id')

    expect(() => SupportEstimateSchema.parse(result)).not.toThrow()
    expect(result).toEqual({
      likelySupport: 1240,
      districtSize: 5200,
      percentOfDistrict: 23.8,
      trendVsLastMonth: 2.1,
    })
  })
})
