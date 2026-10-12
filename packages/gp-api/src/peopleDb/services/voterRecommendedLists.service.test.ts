import { beforeEach, describe, expect, it, vi } from 'vitest'
import { VoterRecommendedListsService } from './voterRecommendedLists.service'
import type { DbxDistrict } from '../databricks/databricksVoterSql.util'
import type { FilterData } from '../schemas/filters.schema'

const DISTRICT_ID = '11111111-2222-3333-4444-555555555555'

const district: DbxDistrict = {
  districtId: DISTRICT_ID,
  state: 'PA',
  districtType: 'Congressional_District',
  districtName: '12',
  useVoterOnlyPath: false,
}

const filters: FilterData = {
  filters: ['voterStatus'],
  filterValues: { voterStatus: ['Super'] },
  filterOperators: {},
}

const idOverrides = { include: ['person-1'] }

describe('VoterRecommendedListsService', () => {
  let countForFilter: ReturnType<typeof vi.fn>
  let rankPrecincts: ReturnType<typeof vi.fn>
  let resolveDistrict: ReturnType<typeof vi.fn>
  let measure: ReturnType<typeof vi.fn>
  let service: VoterRecommendedListsService

  beforeEach(() => {
    countForFilter = vi.fn().mockResolvedValue(400)
    rankPrecincts = vi.fn().mockResolvedValue({
      precincts: [],
      totalVoters: 0,
    })
    resolveDistrict = vi.fn().mockResolvedValue(district)
    measure = vi.fn((args: { read: () => Promise<number> }) => args.read())
    service = new VoterRecommendedListsService(
      {
        countForFilter,
        rankPrecincts,
        resolveDistrict,
      } as never,
      { measure } as never,
    )
  })

  it('logs the count under rec-count and passes idOverrides', async () => {
    await expect(
      service.countForFilter(district, filters, idOverrides),
    ).resolves.toBe(400)

    expect(measure).toHaveBeenCalledWith(
      expect.objectContaining({ op: 'rec-count', districtId: DISTRICT_ID }),
    )
    expect(countForFilter).toHaveBeenCalledWith(district, filters, idOverrides)
  })

  it('logs the ranking under rec-rank-precincts', async () => {
    await service.rankPrecincts(district, filters, idOverrides)

    expect(measure).toHaveBeenCalledWith(
      expect.objectContaining({
        op: 'rec-rank-precincts',
        districtId: DISTRICT_ID,
      }),
    )
    expect(rankPrecincts).toHaveBeenCalledWith(district, filters, idOverrides)
  })

  // District resolution is an election-api hop, not a warehouse read, so it
  // deliberately emits no line — asserting that keeps a future "wrap
  // everything" edit from inventing a voter read that never touched the
  // warehouse and skewing the latency attribution.
  it('does not log a read for district resolution', async () => {
    await expect(service.resolveDistrict(DISTRICT_ID)).resolves.toBe(district)

    expect(resolveDistrict).toHaveBeenCalledWith(DISTRICT_ID)
    expect(measure).not.toHaveBeenCalled()
  })
})
