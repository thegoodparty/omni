import { Test, type TestingModule } from '@nestjs/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SupportEstimateSchema } from '@goodparty_org/contracts'
import { ElectedOfficeSupportService } from '@/electionDb/electedOfficeSupport/electedOfficeSupport.service'
import { SupportEstimateService } from './supportEstimate.service'

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
          provide: ElectedOfficeSupportService,
          useValue: { getByElectedOfficeId },
        },
      ],
    }).compile()
    service = module.get<SupportEstimateService>(SupportEstimateService)
  })

  it('maps an election-database support row to the dashboard estimate', async () => {
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

  // The Prisma row carries createdAt/updatedAt, which the published contract
  // does not. Parsing through ElectedOfficeSupportSchema is what keeps those
  // columns out of the response now that there is no network boundary.
  it('ignores Prisma-only columns on the row', async () => {
    getByElectedOfficeId.mockResolvedValue({
      electedOfficeId: OFFICE,
      supportConstituents: 2893,
      totalConstituents: 4084,
      createdAt: new Date('2026-06-18T00:00:00.000Z'),
      updatedAt: new Date('2026-06-19T00:00:00.000Z'),
    })

    const result = await service.getSupportEstimate(OFFICE)

    expect(result).toEqual({
      likelySupport: 2893,
      districtSize: 4084,
      percentOfDistrict: 70.8,
    })
  })

  it('returns null when there is no row for the office', async () => {
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

  it('throws when the row does not satisfy the support contract', async () => {
    getByElectedOfficeId.mockResolvedValue({
      electedOfficeId: OFFICE,
      supportConstituents: -1,
      totalConstituents: 4084,
    })

    await expect(service.getSupportEstimate(OFFICE)).rejects.toThrow()
  })
})
