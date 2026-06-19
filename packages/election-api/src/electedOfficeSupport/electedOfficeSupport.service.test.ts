import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ElectedOfficeSupportService } from './electedOfficeSupport.service'

describe('ElectedOfficeSupportService', () => {
  let service: ElectedOfficeSupportService
  let findUnique: ReturnType<typeof vi.fn>

  beforeEach(() => {
    findUnique = vi.fn()
    service = new ElectedOfficeSupportService()
    Object.defineProperty(service, '_prisma', {
      value: { electedOfficeSupport: { findUnique } },
    })
  })

  it('looks up the support row by elected office id', async () => {
    const row = {
      electedOfficeId: 'a0000000-0000-0000-0000-000000000001',
      supportConstituents: 2893,
      totalConstituents: 4084,
    }
    findUnique.mockResolvedValue(row)

    const result = await service.getByElectedOfficeId(row.electedOfficeId)

    expect(findUnique).toHaveBeenCalledWith({
      where: { electedOfficeId: row.electedOfficeId },
    })
    expect(result).toEqual(row)
  })

  it('returns null when no row exists for the office', async () => {
    findUnique.mockResolvedValue(null)

    const result = await service.getByElectedOfficeId(
      'a0000000-0000-0000-0000-000000000002',
    )

    expect(result).toBeNull()
  })
})
