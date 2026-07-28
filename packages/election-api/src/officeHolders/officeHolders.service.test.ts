import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OfficeHoldersService } from './officeHolders.service'
import { OfficeHolderFilterDto } from './officeHolders.schema'

describe('OfficeHoldersService.getOfficeHolders', () => {
  let service: OfficeHoldersService
  let findMany: ReturnType<typeof vi.fn>

  beforeEach(() => {
    findMany = vi.fn().mockResolvedValue([])
    service = new OfficeHoldersService()
    Object.defineProperty(service, '_prisma', {
      value: { officeHolder: { findMany } },
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
    })
  })
})
