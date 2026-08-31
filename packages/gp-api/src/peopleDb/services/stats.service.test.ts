import { beforeEach, describe, expect, it, vi } from 'vitest'
import { StatsService, STATS_DUAL_READ_MESSAGE } from './stats.service'

const DISTRICT_ID = '0e5bafca-93a9-86a5-2522-f373979720df'

const statsWith = (total: number, ageTop = 10) => ({
  districtId: DISTRICT_ID,
  updatedAt: new Date(0),
  totalConstituents: total,
  totalConstituentsWithCellPhone: Math.floor(total / 2),
  buckets: {
    age: [
      { label: '51+', count: ageTop, percent: 1 },
      { label: '18-25', count: 1, percent: 1 },
    ],
    education: [],
    homeowner: [],
    presenceOfChildren: [],
    estimatedIncomeRange: [],
  },
})

// The comparison arm is deliberately not awaited by findStats, so tests have to
// let the microtask queue drain before asserting on the log line.
const settle = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve()
}

describe('StatsService', () => {
  let service: StatsService
  let findStats: ReturnType<typeof vi.fn>
  let findStatsLive: ReturnType<typeof vi.fn>
  let measure: ReturnType<typeof vi.fn>
  let info: ReturnType<typeof vi.fn>
  let warn: ReturnType<typeof vi.fn>

  beforeEach(() => {
    findStats = vi.fn().mockResolvedValue(statsWith(42))
    findStatsLive = vi.fn().mockResolvedValue(statsWith(42))
    // measure() runs the real read, so the assertions below cover both the
    // delegation and the op/districtId the read is logged under.
    measure = vi.fn((args: { read: () => unknown }) => args.read())
    info = vi.fn()
    warn = vi.fn()
    service = new StatsService(
      { findStats, findStatsLive } as never,
      { measure } as never,
      { setContext: vi.fn(), info, warn } as never,
    )
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
    findStatsLive.mockResolvedValue(null)

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

  it('serves the mirrored row and logs agreement with the live scan', async () => {
    await service.findStats({ districtId: DISTRICT_ID } as never)
    await settle()

    expect(findStatsLive).toHaveBeenCalledWith(DISTRICT_ID)
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ districtId: DISTRICT_ID, agrees: true }),
      STATS_DUAL_READ_MESSAGE,
    )
  })

  it('names the dimensions that disagree', async () => {
    findStatsLive.mockResolvedValue(statsWith(42, 99))

    await service.findStats({ districtId: DISTRICT_ID } as never)
    await settle()

    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        agrees: false,
        mismatchedDimensions: ['age'],
      }),
      STATS_DUAL_READ_MESSAGE,
    )
  })

  it('reports a total mismatch even when every bucket matches', async () => {
    findStatsLive.mockResolvedValue({ ...statsWith(42), totalConstituents: 41 })

    await service.findStats({ districtId: DISTRICT_ID } as never)
    await settle()

    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ agrees: false, martTotal: 42, liveTotal: 41 }),
      STATS_DUAL_READ_MESSAGE,
    )
  })

  it('counts absent-on-both as agreement', async () => {
    findStats.mockResolvedValue(null)
    findStatsLive.mockResolvedValue(null)

    await service.findStats({ districtId: DISTRICT_ID } as never)
    await settle()

    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ agrees: true, martTotal: null }),
      STATS_DUAL_READ_MESSAGE,
    )
  })

  it('reports absent on one side only as disagreement', async () => {
    findStatsLive.mockResolvedValue(null)

    await service.findStats({ districtId: DISTRICT_ID } as never)
    await settle()

    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ agrees: false, liveTotal: null }),
      STATS_DUAL_READ_MESSAGE,
    )
  })

  it('never lets the live scan affect the response', async () => {
    findStatsLive.mockRejectedValue(new Error('scan blew up'))

    const stats = await service.findStats({ districtId: DISTRICT_ID } as never)
    await settle()

    expect(stats?.totalConstituents).toBe(42)
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ agrees: null }),
      STATS_DUAL_READ_MESSAGE,
    )
  })

  it('caps concurrent live scans', async () => {
    let inFlight = 0
    let peak = 0
    findStatsLive.mockImplementation(async () => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 5))
      inFlight -= 1
      return statsWith(42)
    })

    await Promise.all(
      Array.from({ length: 8 }, () =>
        service.findStats({ districtId: DISTRICT_ID } as never),
      ),
    )
    await new Promise((resolve) => setTimeout(resolve, 120))

    expect(findStatsLive).toHaveBeenCalledTimes(8)
    expect(peak).toBeLessThanOrEqual(2)
  })
})
