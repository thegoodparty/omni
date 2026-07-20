import { describe, expect, it } from 'vitest'
import { useTestService } from '@/test-service'
import { VoterFileFilter } from '../../generated/prisma'
import { VoterFileFilterService } from './voterFileFilter.service'

const filter = (overrides: Partial<VoterFileFilter>): VoterFileFilter =>
  ({
    id: 1,
    organizationSlug: 'campaign-1',
    name: 'My List',
    ...overrides,
  }) as VoterFileFilter

describe('voterFileFilterToAudience', () => {
  const service = new VoterFileFilterService()

  it('maps genderUnknown to the gender_unknown filter', async () => {
    const audience = await service.voterFileFilterToAudience(
      filter({ genderUnknown: true }),
    )

    expect(audience).toEqual({ gender_unknown: true })
  })

  it('maps the rich list fields backed by an L2 column', async () => {
    const audience = await service.voterFileFilterToAudience(
      filter({
        hasCellPhone: true,
        hasLandline: true,
        ethnicityEuropean: true,
        ethnicityAsian: true,
        ethnicityHispanic: true,
        ethnicityAfricanAmerican: true,
      }),
    )

    expect(audience).toEqual({
      has_cell_phone: true,
      has_landline: true,
      ethnicity_european: true,
      ethnicity_asian: true,
      ethnicity_hispanic: true,
      ethnicity_african_american: true,
    })
  })
})

describe('stampFirstUsedForOutreach', () => {
  const service = useTestService()

  const seedFilter = async () => {
    const orgSlug = `org-stamp-${Math.random().toString(36).slice(2)}`
    await service.prisma.organization.create({
      data: { slug: orgSlug, ownerId: service.user.id },
    })
    const filter = await service.prisma.voterFileFilter.create({
      data: { organizationSlug: orgSlug, name: 'stamp list' },
    })
    return { orgSlug, filter }
  }

  it('sets firstUsedForOutreachAt exactly once', async () => {
    const { orgSlug, filter } = await seedFilter()
    const svc = service.app.get(VoterFileFilterService)

    const count = await svc.stampFirstUsedForOutreach(filter.id, orgSlug)
    expect(count).toBe(1)

    const stamped = await service.prisma.voterFileFilter.findUniqueOrThrow({
      where: { id: filter.id },
    })
    expect(stamped.firstUsedForOutreachAt).not.toBeNull()
  })

  it('is a no-op once already stamped and never clears the timestamp', async () => {
    const { orgSlug, filter } = await seedFilter()
    const svc = service.app.get(VoterFileFilterService)

    await svc.stampFirstUsedForOutreach(filter.id, orgSlug)
    const firstStamp = await service.prisma.voterFileFilter.findUniqueOrThrow({
      where: { id: filter.id },
    })

    const secondCount = await svc.stampFirstUsedForOutreach(filter.id, orgSlug)
    expect(secondCount).toBe(0)

    const secondStamp = await service.prisma.voterFileFilter.findUniqueOrThrow({
      where: { id: filter.id },
    })
    expect(secondStamp.firstUsedForOutreachAt).toEqual(
      firstStamp.firstUsedForOutreachAt,
    )
  })

  it('two concurrent stamps claim the row exactly once total', async () => {
    const { orgSlug, filter } = await seedFilter()
    const svc = service.app.get(VoterFileFilterService)

    const [countA, countB] = await Promise.all([
      svc.stampFirstUsedForOutreach(filter.id, orgSlug),
      svc.stampFirstUsedForOutreach(filter.id, orgSlug),
    ])

    expect(countA + countB).toBe(1)
  })
})
