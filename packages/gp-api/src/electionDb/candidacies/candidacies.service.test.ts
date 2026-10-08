import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CandidaciesService } from './candidacies.service'
import {
  CandidacyFilterDto,
  DEFAULT_CANDIDACY_PAGE_SIZE,
} from './candidacies.schema'

const PAGING = {
  orderBy: { id: 'asc' },
  skip: 0,
  take: DEFAULT_CANDIDACY_PAGE_SIZE,
}

describe('CandidaciesService.getCandidacies', () => {
  let service: CandidaciesService
  let findMany: ReturnType<typeof vi.fn>

  beforeEach(() => {
    findMany = vi.fn().mockResolvedValue([])
    service = new CandidaciesService()
    Object.defineProperty(service, '_electionDb', {
      value: { instance: { candidacy: { findMany } } },
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
      ...PAGING,
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
      ...PAGING,
    })
  })

  // `GET /candidacies` previously ran an unbounded findMany, so an unfiltered
  // M2M call could pull the whole table with relations eagerly loaded.
  it('bounds an unfiltered query rather than scanning the table', async () => {
    await service.getCandidacies({} as CandidacyFilterDto)

    const args = findMany.mock.calls[0]?.[0]
    expect(args.take).toBe(DEFAULT_CANDIDACY_PAGE_SIZE)
    expect(args.skip).toBe(0)
  })

  it('stays bounded when the filter is built without the DTO defaults', async () => {
    await service.getCandidacies({
      state: 'TX',
      includeStances: true,
      includeRace: true,
    } as CandidacyFilterDto)

    const args = findMany.mock.calls[0]?.[0]
    expect(args.take).toBe(DEFAULT_CANDIDACY_PAGE_SIZE)
  })

  it('offsets by whole pages and orders on a unique column', async () => {
    await service.getCandidacies({
      page: 3,
      pageSize: 50,
    } as CandidacyFilterDto)

    const args = findMany.mock.calls[0]?.[0]
    expect(args.skip).toBe(100)
    expect(args.take).toBe(50)
    // A non-unique order would let a row repeat or vanish across pages.
    expect(args.orderBy).toEqual({ id: 'asc' })
  })
})
