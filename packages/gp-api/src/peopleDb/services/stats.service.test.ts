import { beforeEach, describe, expect, it, vi } from 'vitest'
import { StatsService } from './stats.service'

const DISTRICT_ID = '0e5bafca-93a9-86a5-2522-f373979720df'

describe('StatsService', () => {
  let service: StatsService
  let findStats: ReturnType<typeof vi.fn>
  let measure: ReturnType<typeof vi.fn>

  beforeEach(() => {
    findStats = vi.fn().mockResolvedValue({
      districtId: DISTRICT_ID,
      totalConstituents: 42,
    })
    // measure() runs the real read, so the assertions below cover both the
    // delegation and the op/districtId the read is logged under.
    measure = vi.fn((args: { read: () => unknown }) => args.read())
    service = new StatsService({ findStats } as never, { measure } as never)
  })

  it('reads the district stats row under the stats op', async () => {
    const stats = await service.findStats({ districtId: DISTRICT_ID } as never)

    expect(findStats).toHaveBeenCalledWith(DISTRICT_ID)
    expect(measure).toHaveBeenCalledWith(
      expect.objectContaining({ op: 'stats', districtId: DISTRICT_ID }),
    )
    expect(stats?.totalConstituents).toBe(42)
  })

  it('returns null for a district with no stats row', async () => {
    findStats.mockResolvedValue(null)

    await expect(
      service.findStats({ districtId: DISTRICT_ID } as never),
    ).resolves.toBeNull()
  })

  it('propagates a warehouse failure rather than serving null', async () => {
    findStats.mockRejectedValue(new Error('warehouse down'))

    await expect(
      service.findStats({ districtId: DISTRICT_ID } as never),
    ).rejects.toThrow('warehouse down')
  })
})
