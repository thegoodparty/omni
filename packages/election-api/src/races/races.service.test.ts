import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RacesService } from './races.service'
import { DEFAULT_RACE_PAGE_SIZE, RaceFilterDto } from './races.schema'

describe('RacesService.findFilingFeeByBrHashId', () => {
  let service: RacesService
  let raceFindMany: ReturnType<typeof vi.fn>

  beforeEach(() => {
    raceFindMany = vi.fn()
    service = new RacesService()
    Object.defineProperty(service, '_prisma', {
      value: {
        race: {
          findMany: raceFindMany,
        },
      },
    })
  })

  it('returns an empty result when no Race matches the hash', async () => {
    raceFindMany.mockResolvedValue([])

    const result = await service.findFilingFeeByBrHashId('Z2lk-missing')

    expect(raceFindMany).toHaveBeenCalledWith({
      where: { brHashId: 'Z2lk-missing' },
      select: {
        filingRequirements: true,
        salary: true,
        filingOfficeAddress: true,
        filingPhoneNumber: true,
        paperworkInstructions: true,
      },
      orderBy: [
        { isPrimary: { sort: 'asc', nulls: 'last' } },
        { isRunoff: { sort: 'asc', nulls: 'last' } },
      ],
      take: 1,
    })
    expect(result).toEqual({
      filingFee: null,
      filingRequirementsText: null,
      extractionSource: null,
      filingOfficeAddress: null,
      filingPhoneNumber: null,
      paperworkInstructions: null,
    })
  })

  it('queries Prisma with deterministic ordering so multi-row matches resolve consistently', async () => {
    // brHashId has no @unique constraint in the schema, so the same hash
    // can in principle map to multiple Race rows (general / primary /
    // runoff). orderBy guarantees we pick the same row every time.
    raceFindMany.mockResolvedValue([
      { filingRequirements: 'Filing fee: $40.', salary: null },
    ])

    await service.findFilingFeeByBrHashId('Z2lk-multi-row')

    expect(raceFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [
          { isPrimary: { sort: 'asc', nulls: 'last' } },
          { isRunoff: { sort: 'asc', nulls: 'last' } },
        ],
        take: 1,
      }),
    )
  })

  it('extracts a direct dollar amount when filing_requirements has exactly one $N', async () => {
    raceFindMany.mockResolvedValue([
      {
        filingRequirements: 'Filing fee: $25 due at filing.',
        salary: null,
      },
    ])

    const result = await service.findFilingFeeByBrHashId('Z2lk-direct')

    expect(result.filingFee).toBe(25)
    expect(result.extractionSource).toBe('direct_dollar')
    expect(result.filingRequirementsText).toBe('Filing fee: $25 due at filing.')
  })

  it('returns multi_value with null filingFee when multiple $N values appear', async () => {
    // BallotReady multi-fee rows (e.g. per-party fees) — the extractor
    // refuses to pick one to avoid silently lying. UI surfaces the raw text.
    raceFindMany.mockResolvedValue([
      {
        filingRequirements:
          'D/R candidates: $100. Independent candidates: $50.',
        salary: null,
      },
    ])

    const result = await service.findFilingFeeByBrHashId('Z2lk-multi')

    expect(result.filingFee).toBeNull()
    expect(result.extractionSource).toBe('multi_value')
    expect(result.filingRequirementsText).toBe(
      'D/R candidates: $100. Independent candidates: $50.',
    )
  })

  it('extracts $0 via direct_dollar when filing_requirements contains $0', async () => {
    raceFindMany.mockResolvedValue([
      {
        filingRequirements: 'Filing Fee = $0; petition required.',
        salary: null,
      },
    ])

    const result = await service.findFilingFeeByBrHashId('Z2lk-zero-dollar')

    expect(result.filingFee).toBe(0)
    expect(result.extractionSource).toBe('direct_dollar')
  })

  it('returns filingFee 0 via no_fee when text says no fee without a dollar sign', async () => {
    raceFindMany.mockResolvedValue([
      {
        filingRequirements: 'No filing fee required; petition signatures only.',
        salary: null,
      },
    ])

    const result = await service.findFilingFeeByBrHashId('Z2lk-no-fee')

    expect(result.filingFee).toBe(0)
    expect(result.extractionSource).toBe('no_fee')
    expect(result.filingRequirementsText).toBe(
      'No filing fee required; petition signatures only.',
    )
  })

  it('computes pct_of_salary when filing_requirements has a percentage and salary is parseable', async () => {
    raceFindMany.mockResolvedValue([
      {
        filingRequirements: 'Filing fee is 1% of salary.',
        salary: '$80,000',
      },
    ])

    const result = await service.findFilingFeeByBrHashId('Z2lk-pct')

    expect(result.filingFee).toBe(800)
    expect(result.extractionSource).toBe('pct_of_salary')
  })

  it('returns no_match with null filingFee when no extraction rule applies', async () => {
    raceFindMany.mockResolvedValue([
      {
        filingRequirements: 'Petition signatures required; see town clerk.',
        salary: null,
      },
    ])

    const result = await service.findFilingFeeByBrHashId('Z2lk-no-match')

    expect(result.filingFee).toBeNull()
    expect(result.extractionSource).toBe('no_match')
    expect(result.filingRequirementsText).toBe(
      'Petition signatures required; see town clerk.',
    )
  })

  it('maps the structured filing-office contact off the matched Race row', async () => {
    raceFindMany.mockResolvedValue([
      {
        filingRequirements: 'Filing fee: $30.',
        salary: null,
        filingOfficeAddress: '123 Main St, Springfield, IL 62701',
        filingPhoneNumber: '(217) 555-0100',
        paperworkInstructions: 'File with the county clerk in person.',
      },
    ])

    const result = await service.findFilingFeeByBrHashId('Z2lk-office')

    expect(result.filingOfficeAddress).toBe(
      '123 Main St, Springfield, IL 62701',
    )
    expect(result.filingPhoneNumber).toBe('(217) 555-0100')
    expect(result.paperworkInstructions).toBe(
      'File with the county clerk in person.',
    )
    // Fee extraction still runs alongside the office mapping.
    expect(result.filingFee).toBe(30)
  })

  it('returns null office fields when BallotReady left them blank', async () => {
    raceFindMany.mockResolvedValue([
      {
        filingRequirements: 'Filing fee: $30.',
        salary: null,
        filingOfficeAddress: null,
        filingPhoneNumber: null,
        paperworkInstructions: null,
      },
    ])

    const result = await service.findFilingFeeByBrHashId('Z2lk-no-office')

    expect(result.filingOfficeAddress).toBeNull()
    expect(result.filingPhoneNumber).toBeNull()
    expect(result.paperworkInstructions).toBeNull()
  })
})

describe('RacesService.findFrequencyByBrHashId', () => {
  let service: RacesService
  let raceFindMany: ReturnType<typeof vi.fn>

  beforeEach(() => {
    raceFindMany = vi.fn()
    service = new RacesService()
    Object.defineProperty(service, '_prisma', {
      value: {
        race: {
          findMany: raceFindMany,
        },
      },
    })
  })

  it('returns empty frequency and null date when no Race matches the hash', async () => {
    raceFindMany.mockResolvedValue([])

    const result = await service.findFrequencyByBrHashId('Z2lk-missing')

    expect(raceFindMany).toHaveBeenCalledWith({
      where: { brHashId: 'Z2lk-missing' },
      select: { frequency: true, electionDate: true },
      orderBy: [
        { isPrimary: { sort: 'asc', nulls: 'last' } },
        { isRunoff: { sort: 'asc', nulls: 'last' } },
      ],
      take: 1,
    })
    expect(result).toEqual({ frequency: [], electionDate: null })
  })

  it('returns the matched race frequency and ISO election date', async () => {
    raceFindMany.mockResolvedValue([
      { frequency: [4], electionDate: new Date('2024-11-05T00:00:00.000Z') },
    ])

    const result = await service.findFrequencyByBrHashId('Z2lk-four-year')

    expect(result).toEqual({
      frequency: [4],
      electionDate: '2024-11-05T00:00:00.000Z',
    })
  })

  it('preserves a multi-element cadence array as stored', async () => {
    raceFindMany.mockResolvedValue([
      { frequency: [2, 4], electionDate: new Date('2024-11-05T00:00:00.000Z') },
    ])

    const result = await service.findFrequencyByBrHashId('Z2lk-staggered')

    expect(result.frequency).toEqual([2, 4])
  })
})

describe('RacesService.findRaces — candidacy PII', () => {
  let service: RacesService
  let raceFindMany: ReturnType<typeof vi.fn>

  beforeEach(() => {
    raceFindMany = vi.fn().mockResolvedValue([{ id: 'race-1' }])
    service = new RacesService()
    Object.defineProperty(service, '_prisma', {
      value: { race: { findMany: raceFindMany } },
    })
  })

  it('omits candidacy email when including candidacies with no explicit columns', async () => {
    await service.findRaces({ includeCandidacies: true } as RaceFilterDto)

    const args = raceFindMany.mock.calls[0]?.[0]
    // Never a bare `true` — that would expand to all scalars incl. email.
    expect(args.include.Candidacies).toEqual({ omit: { email: true } })
  })

  it('omits candidacy email on the select path too (raceColumns + includeCandidacies)', async () => {
    await service.findRaces({
      raceColumns: 'id',
      includeCandidacies: true,
    } as RaceFilterDto)

    const args = raceFindMany.mock.calls[0]?.[0]
    // raceColumns present -> top-level `select`; the Candidacies relation still
    // carries the omit so email never comes back.
    expect(args.select.Candidacies).toEqual({ omit: { email: true } })
  })
})

describe('RacesService.findRaces — pagination', () => {
  let service: RacesService
  let raceFindMany: ReturnType<typeof vi.fn>

  beforeEach(() => {
    raceFindMany = vi.fn().mockResolvedValue([{ id: 'race-1' }])
    service = new RacesService()
    Object.defineProperty(service, '_prisma', {
      value: { race: { findMany: raceFindMany } },
    })
  })

  it('bounds the query with the default page size and a stable order', async () => {
    await service.findRaces({
      state: 'TX',
      page: 1,
      pageSize: DEFAULT_RACE_PAGE_SIZE,
    } as RaceFilterDto)

    const args = raceFindMany.mock.calls[0]?.[0]
    expect(args.take).toBe(DEFAULT_RACE_PAGE_SIZE)
    expect(args.skip).toBe(0)
    // Deterministic order is required for offset pagination and keeps
    // same-slug rows adjacent for the downstream dedupe.
    expect(args.orderBy).toEqual([{ slug: 'asc' }, { id: 'asc' }])
    expect(args.where).toEqual({ state: 'TX' })
  })

  it('computes skip from page and pageSize', async () => {
    await service.findRaces({
      page: 3,
      pageSize: 100,
    } as RaceFilterDto)

    const args = raceFindMany.mock.calls[0]?.[0]
    expect(args.skip).toBe(200)
    expect(args.take).toBe(100)
  })

  it('applies the bound on the select path too', async () => {
    await service.findRaces({
      raceColumns: 'id',
      page: 2,
      pageSize: 250,
    } as RaceFilterDto)

    const args = raceFindMany.mock.calls[0]?.[0]
    expect(args.select).toBeDefined()
    expect(args.skip).toBe(250)
    expect(args.take).toBe(250)
    expect(args.orderBy).toEqual([{ slug: 'asc' }, { id: 'asc' }])
  })
})
