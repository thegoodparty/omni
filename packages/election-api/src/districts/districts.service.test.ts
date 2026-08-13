import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DistrictsService } from './districts.service'
import { GetDistrictNamesDto, GetDistrictTypesDTO } from './districts.schema'

describe('DistrictsService discovery endpoints', () => {
  let service: DistrictsService
  let findMany: ReturnType<typeof vi.fn>

  beforeEach(() => {
    findMany = vi.fn().mockResolvedValue([])
    service = new DistrictsService()
    Object.defineProperty(service, '_prisma', {
      value: { district: { findMany } },
    })
  })

  const whereOf = () =>
    (findMany.mock.calls[0]?.[0] as { where: { AND: unknown[] } }).where

  it('excludes proposed districts from the type list', async () => {
    await service.getDistrictTypes({
      state: 'OH',
    } as unknown as GetDistrictTypesDTO)

    expect(whereOf().AND).toContainEqual({
      L2DistrictType: { notIn: ['Proposed_District'] },
    })
  })

  it('excludes proposed districts from the name list', async () => {
    await service.getDistrictNames({
      state: 'OH',
    } as unknown as GetDistrictNamesDto)

    expect(whereOf().AND).toContainEqual({
      L2DistrictType: { notIn: ['Proposed_District'] },
    })
  })

  // The exclusion is the point of the change, so asking for the type by name
  // must not defeat it — otherwise the override picker could still reach a
  // proposed map by passing the type through.
  it('still excludes proposed districts when the caller asks for that type', async () => {
    await service.getDistrictNames({
      state: 'OH',
      L2DistrictType: 'Proposed_District',
    } as unknown as GetDistrictNamesDto)

    const { AND } = whereOf()
    expect(AND).toContainEqual({
      state: 'OH',
      L2DistrictType: 'Proposed_District',
    })
    expect(AND).toContainEqual({
      L2DistrictType: { notIn: ['Proposed_District'] },
    })
  })

  it('leaves the caller filters intact for ordinary types', async () => {
    await service.getDistrictTypes({
      state: 'OH',
      L2DistrictType: 'US_Congressional_District',
    } as unknown as GetDistrictTypesDTO)

    expect(whereOf().AND).toContainEqual({
      state: 'OH',
      L2DistrictType: 'US_Congressional_District',
    })
  })
})
