import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CandidaciesService } from './candidacies.service'
import { CandidacyFilterDto } from './candidacies.schema'

describe('CandidaciesService.getCandidacies', () => {
  let service: CandidaciesService
  let findMany: ReturnType<typeof vi.fn>

  beforeEach(() => {
    findMany = vi.fn().mockResolvedValue([])
    // Pass-through stub: the suppression itself is covered below and in the
    // PersonRemovalsService suite, so these cases assert the query shape only.
    service = new CandidaciesService({
      blankRemovedPersonFields: vi.fn(async (rows) => rows),
      findRemovedPersonIds: vi.fn(async () => new Set<string>()),
    } as never)
    Object.defineProperty(service, '_prisma', {
      value: { candidacy: { findMany } },
    })
  })

  it('omits the email PII field on the default (no-columns) response', async () => {
    await service.getCandidacies({
      includeStances: false,
      includeRace: false,
    } as CandidacyFilterDto)

    expect(findMany).toHaveBeenCalledWith({
      where: {},
      omit: { email: true },
      include: undefined,
    })
  })

  it('still omits email when stances/race are included (no columns)', async () => {
    await service.getCandidacies({
      includeStances: true,
      includeRace: true,
    } as CandidacyFilterDto)

    const args = findMany.mock.calls[0]?.[0]
    expect(args.omit).toEqual({ email: true })
    // include is populated for the relations, but email is still omitted.
    expect(args.include).toBeDefined()
    expect(args.select).toBeUndefined()
  })

  it('selects only the requested non-PII columns when columns are provided', async () => {
    await service.getCandidacies({
      columns: 'id,firstName',
      includeStances: false,
      includeRace: false,
    } as CandidacyFilterDto)

    expect(findMany).toHaveBeenCalledWith({
      where: {},
      select: { id: true, firstName: true },
    })
  })
})

describe('CandidaciesService removal suppression', () => {
  const REMOVED = '11111111-1111-1111-1111-111111111111'

  const makeService = (findMany: ReturnType<typeof vi.fn>) => {
    const service = new CandidaciesService({
      blankRemovedPersonFields: vi.fn(
        async (rows: Record<string, unknown>[]) => {
          for (const row of rows) {
            if (row.personId === REMOVED && 'image' in row) row.image = null
          }
          return rows
        },
      ),
    } as never)
    Object.defineProperty(service, '_prisma', {
      value: { candidacy: { findMany } },
    })
    return service
  }

  it('selects personId so a removal can be attributed, then drops it again', async () => {
    const findMany = vi
      .fn()
      .mockResolvedValue([
        { id: 'c1', image: 'https://cdn.example.org/a.jpg', personId: REMOVED },
      ])
    const service = makeService(findMany)

    const rows = (await service.getCandidacies({
      columns: 'id,image',
      includeStances: false,
      includeRace: false,
    } as CandidacyFilterDto)) as Record<string, unknown>[]

    // personId was added to the query purely to attribute the removal...
    expect(findMany).toHaveBeenCalledWith({
      where: {},
      select: { id: true, image: true, personId: true },
    })
    // ...and must not leak into a response that never asked for it.
    expect(rows[0] && 'personId' in rows[0]).toBe(false)
    expect(rows[0]?.image).toBeNull()
  })

  it('keeps personId when the caller asked for it', async () => {
    const findMany = vi
      .fn()
      .mockResolvedValue([{ image: 'x', personId: REMOVED }])
    const service = makeService(findMany)

    const rows = (await service.getCandidacies({
      columns: 'image,personId',
      includeStances: false,
      includeRace: false,
    } as CandidacyFilterDto)) as Record<string, unknown>[]

    expect(rows[0]?.personId).toBe(REMOVED)
  })

  it('does not add personId when no suppressible column was requested', async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 'c1', slug: 'a-b' }])
    const service = makeService(findMany)

    await service.getCandidacies({
      columns: 'id,slug',
      includeStances: false,
      includeRace: false,
    } as CandidacyFilterDto)

    expect(findMany).toHaveBeenCalledWith({
      where: {},
      select: { id: true, slug: true },
    })
  })
})
