import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CandidaciesService } from './candidacies.service'
import { CandidacyFilterDto } from './candidacies.schema'

describe('CandidaciesService.getCandidacies', () => {
  let service: CandidaciesService
  let findMany: ReturnType<typeof vi.fn>

  beforeEach(() => {
    findMany = vi.fn().mockResolvedValue([])
    service = new CandidaciesService()
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
