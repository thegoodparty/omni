import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CandidaciesService } from './candidacies.service'
import { CandidacyFilterDto } from './candidacies.schema'

describe('CandidaciesService.getCandidacies', () => {
  let service: CandidaciesService
  let findMany: ReturnType<typeof vi.fn>

  beforeEach(() => {
    findMany = vi.fn().mockResolvedValue([])
    service = new CandidaciesService()
    // The base class reads the delegate from `_prisma[modelName]`.
    ;(service as unknown as { _prisma: unknown })._prisma = {
      candidacy: { findMany },
    }
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
