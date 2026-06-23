import { Test, type TestingModule } from '@nestjs/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SupportEstimateSchema } from '@goodparty_org/contracts'
import { SupportEstimateService } from './supportEstimate.service'
import { ElectedOfficeSupportApiService } from './electedOfficeSupportApi.service'

const OFFICE = 'a0000000-0000-0000-0000-000000000001'

describe('SupportEstimateService', () => {
  let service: SupportEstimateService
  let getByElectedOfficeId: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    getByElectedOfficeId = vi.fn()
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SupportEstimateService,
        {
          provide: ElectedOfficeSupportApiService,
          useValue: { getByElectedOfficeId },
        },
      ],
    }).compile()
    service = module.get<SupportEstimateService>(SupportEstimateService)
  })

  it('maps an election-api support row to the dashboard estimate', async () => {
    getByElectedOfficeId.mockResolvedValue({
      electedOfficeId: OFFICE,
      supportConstituents: 2893,
      totalConstituents: 4084,
    })

    const result = await service.getSupportEstimate(OFFICE)

    expect(getByElectedOfficeId).toHaveBeenCalledWith(OFFICE)
    expect(result).toEqual({
      likelySupport: 2893,
      districtSize: 4084,
      percentOfDistrict: 70.8,
    })
    expect(() => SupportEstimateSchema.parse(result)).not.toThrow()
  })

  it('returns null when election-api has no row for the office', async () => {
    getByElectedOfficeId.mockResolvedValue(null)

    expect(await service.getSupportEstimate(OFFICE)).toBeNull()
  })

  it('returns null when district size is zero (no divide-by-zero)', async () => {
    getByElectedOfficeId.mockResolvedValue({
      electedOfficeId: OFFICE,
      supportConstituents: 0,
      totalConstituents: 0,
    })

    expect(await service.getSupportEstimate(OFFICE)).toBeNull()
  })
})
