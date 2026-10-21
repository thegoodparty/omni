import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ZipToPositionService } from './zipToPosition.service'

describe('ZipToPositionService.search', () => {
  let service: ZipToPositionService
  let findMany: ReturnType<typeof vi.fn>
  let raceFindMany: ReturnType<typeof vi.fn>

  const positionRow = {
    positionId: 'pos-1',
    name: 'Mayor',
    displayOfficeLevel: 'City',
    state: 'CA',
    district: '',
    position: { brPositionId: 'br-pos-1' },
  }

  beforeEach(() => {
    findMany = vi.fn().mockResolvedValue([positionRow])
    raceFindMany = vi.fn().mockResolvedValue([])
    service = new ZipToPositionService()
    Object.defineProperty(service, '_electionDb', {
      value: {
        instance: {
          zipToPosition: { findMany },
          race: { findMany: raceFindMany },
        },
      },
    })
  })

  it('queries ZipToPosition for distinct positionIds + display metadata', async () => {
    await service.search({ zip: '90210' })

    expect(findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { pctDistrictzipToZip: null },
          { pctDistrictzipToZip: { gte: 0.005 } },
        ],
        zipCode: '90210',
      },
      select: {
        positionId: true,
        name: true,
        displayOfficeLevel: true,
        state: true,
        district: true,
        position: { select: { brPositionId: true } },
      },
      distinct: ['positionId'],
    })
  })

  it('joins Race by the covered positionIds', async () => {
    await service.search({ zip: '90210' })

    expect(raceFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ positionId: { in: ['pos-1'] } }),
      }),
    )
  })

  it('returns an empty array (and skips the Race query) when no positions match', async () => {
    findMany.mockResolvedValue([])

    const result = await service.search({ zip: '00000' })

    expect(result).toEqual([])
    expect(raceFindMany).not.toHaveBeenCalled()
  })

  it('filters Race to future elections by default', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-12T12:00:00Z'))

    await service.search({ zip: '90210' })

    expect(raceFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          electionDate: {
            gte: new Date('2026-05-12T00:00:00Z'),
            lte: new Date('2028-05-12T00:00:00Z'),
          },
        }),
      }),
    )
    vi.useRealTimers()
  })

  // Feb 29 + 2 years is not a real date, so setUTCFullYear rolls it to Mar 1.
  // A one-day-wider horizon is harmless; pinning it here keeps the rollover
  // from looking like a bug to the next reader.
  it('rolls a leap-day horizon forward to March 1', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2028-02-29T12:00:00Z'))

    await service.search({ zip: '90210', timeframe: 'future' })

    expect(raceFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          electionDate: {
            gte: new Date('2028-02-29T00:00:00Z'),
            lte: new Date('2030-03-01T00:00:00Z'),
          },
        }),
      }),
    )
    vi.useRealTimers()
  })

  it('filters Race to past elections when timeframe is past', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-12T12:00:00Z'))

    await service.search({ zip: '90210', timeframe: 'past' })

    expect(raceFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          electionDate: { lt: new Date('2026-05-12T00:00:00Z') },
        }),
      }),
    )
    vi.useRealTimers()
  })

  it('always applies the null-safe pct_districtzip_to_zip threshold filter', async () => {
    await service.search({ zip: '90210' })

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { pctDistrictzipToZip: null },
            { pctDistrictzipToZip: { gte: 0.005 } },
          ],
        }),
      }),
    )
  })

  it('filters by displayOfficeLevels when provided', async () => {
    await service.search({
      zip: '90210',
      displayOfficeLevels: ['City', 'Township'],
    })

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          zipCode: '90210',
          displayOfficeLevel: { in: ['City', 'Township'] },
        }),
      }),
    )
  })

  it('maps a Race + position metadata + Place into a RaceListItem', async () => {
    findMany.mockResolvedValue([positionRow])
    raceFindMany.mockResolvedValue([
      {
        id: 'race-1',
        positionId: 'pos-1',
        electionDate: new Date('2026-11-03'),
        isPrimary: false,
        isRunoff: false,
        Place: { name: 'Beverly Hills' },
      },
    ])

    const result = await service.search({ zip: '90210' })

    expect(result).toEqual([
      {
        id: 'race-1',
        brPositionId: 'br-pos-1',
        position: { name: 'Mayor', level: 'City', state: 'CA' },
        election: { electionDay: '2026-11-03' },
        isPrimary: false,
        isRunoff: false,
        city: 'Beverly Hills',
        district: null,
      },
    ])
  })

  it('filters by name with case-insensitive substring', async () => {
    await service.search({ name: 'mayor' })
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          name: { contains: 'mayor', mode: 'insensitive' },
        }),
      }),
    )
  })

  it('filters by officeType (exact match against array)', async () => {
    await service.search({ officeType: ['Mayor', 'Sheriff'] })
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          officeType: { in: ['Mayor', 'Sheriff'] },
        }),
      }),
    )
  })

  it('combines zip + name + officeType when all provided', async () => {
    await service.search({
      zip: '90210',
      name: 'mayor',
      officeType: ['Mayor'],
    })
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          zipCode: '90210',
          name: { contains: 'mayor', mode: 'insensitive' },
          officeType: { in: ['Mayor'] },
        }),
      }),
    )
  })
})

describe('ZipToPositionService.getZipCodesByBrPositionId', () => {
  let service: ZipToPositionService
  let findUnique: ReturnType<typeof vi.fn>
  let findMany: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-12T12:00:00Z'))
    findUnique = vi.fn()
    findMany = vi.fn().mockResolvedValue([])
    service = new ZipToPositionService()
    Object.defineProperty(service, '_electionDb', {
      value: {
        instance: {
          zipToPosition: { findMany },
          position: { findUnique },
        },
      },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('throws NotFoundException when no Position matches brPositionId', async () => {
    findUnique.mockResolvedValue(null)

    await expect(
      service.getZipCodesByBrPositionId('br-missing'),
    ).rejects.toThrowError(/Position br-missing not found/)
    expect(findMany).not.toHaveBeenCalled()
  })

  it('queries ZipToPosition by positionId, future elections, threshold, non-null zip', async () => {
    findUnique.mockResolvedValue({ id: 'position-uuid-1' })

    await service.getZipCodesByBrPositionId('br-pos-1')

    expect(findUnique).toHaveBeenCalledWith({
      where: { brPositionId: 'br-pos-1' },
      select: { id: true },
    })
    expect(findMany).toHaveBeenCalledWith({
      where: {
        positionId: 'position-uuid-1',
        electionDate: { gte: new Date('2026-05-12T00:00:00Z') },
        OR: [
          { pctDistrictzipToZip: null },
          { pctDistrictzipToZip: { gte: 0.005 } },
        ],
        zipCode: { not: null },
      },
      select: { zipCode: true },
      distinct: ['zipCode'],
    })
  })

  it('returns sorted zip codes and drops any null rows from results', async () => {
    findUnique.mockResolvedValue({ id: 'position-uuid-1' })
    findMany.mockResolvedValue([
      { zipCode: '90212' },
      { zipCode: null },
      { zipCode: '90210' },
      { zipCode: '90211' },
    ])

    const result = await service.getZipCodesByBrPositionId('br-pos-1')

    expect(result).toEqual(['90210', '90211', '90212'])
  })

  it('returns an empty array when no rows match', async () => {
    findUnique.mockResolvedValue({ id: 'position-uuid-1' })
    findMany.mockResolvedValue([])

    const result = await service.getZipCodesByBrPositionId('br-pos-1')

    expect(result).toEqual([])
  })
})
