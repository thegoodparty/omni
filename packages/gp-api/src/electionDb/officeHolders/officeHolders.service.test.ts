import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OfficeHoldersService } from './officeHolders.service'
import {
  DEFAULT_OFFICE_HOLDER_PAGE_SIZE,
  OfficeHolderFilterDto,
} from './officeHolders.schema'

const PAGING = {
  orderBy: { id: 'asc' },
  skip: 0,
  take: DEFAULT_OFFICE_HOLDER_PAGE_SIZE,
}

describe('OfficeHoldersService.getOfficeHolders', () => {
  let service: OfficeHoldersService
  let findMany: ReturnType<typeof vi.fn>

  beforeEach(() => {
    findMany = vi.fn().mockResolvedValue([])
    service = new OfficeHoldersService()
    Object.defineProperty(service, '_electionDb', {
      value: { instance: { officeHolder: { findMany } } },
    })
  })

  it('filters by personId and includes Position when requested', async () => {
    await service.getOfficeHolders({
      personId: 'p1',
      includePosition: true,
    } as OfficeHolderFilterDto)

    expect(findMany).toHaveBeenCalledWith({
      where: { personId: 'p1' },
      include: { Position: true },
      ...PAGING,
    })
  })

  it('selects requested columns without a Position include', async () => {
    await service.getOfficeHolders({
      personId: 'p1',
      columns: 'id,positionName',
      includePosition: false,
    } as OfficeHolderFilterDto)

    expect(findMany).toHaveBeenCalledWith({
      where: { personId: 'p1' },
      select: { id: true, positionName: true },
      ...PAGING,
    })
  })

  // Previously an unbounded findMany: `?state=TX` with includePosition could
  // pull the whole table with Position eagerly loaded.
  it('bounds an unfiltered query rather than scanning the table', async () => {
    await service.getOfficeHolders({} as OfficeHolderFilterDto)

    const args = findMany.mock.calls[0]?.[0]
    expect(args.take).toBe(DEFAULT_OFFICE_HOLDER_PAGE_SIZE)
    expect(args.skip).toBe(0)
    expect(args.orderBy).toEqual({ id: 'asc' })
  })

  it('offsets by whole pages', async () => {
    await service.getOfficeHolders({
      page: 4,
      pageSize: 25,
    } as OfficeHolderFilterDto)

    const args = findMany.mock.calls[0]?.[0]
    expect(args.skip).toBe(75)
    expect(args.take).toBe(25)
  })
})
