import { describe, expect, it } from 'vitest'
import { useTestService } from '@/test-service'
import { OutreachType, VoterFileFilter } from '../../generated/prisma'
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

  it('maps partyOther to the party_other filter', async () => {
    const audience = await service.voterFileFilterToAudience(
      filter({ partyOther: true }),
    )

    expect(audience).toEqual({ party_other: true })
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

describe('findOutreachesByVoterFileFilterId', () => {
  const service = useTestService()

  const seedCampaignAndFilter = async () => {
    const orgSlug = `org-outreach-${Math.random().toString(36).slice(2)}`
    await service.prisma.organization.create({
      data: { slug: orgSlug, ownerId: service.user.id },
    })
    const campaign = await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: `${orgSlug}-campaign`,
        organizationSlug: orgSlug,
      },
    })
    const filter = await service.prisma.voterFileFilter.create({
      data: { organizationSlug: orgSlug, name: 'outreach history list' },
    })
    return { campaign, filter }
  }

  // ENG-10776: this reproduces the reported bug — a null-date row sorted
  // ahead of a real send. Postgres `ORDER BY date DESC` defaults to
  // NULLS FIRST, so this fails on develop's plain `{ date: 'desc' }` and
  // only passes with the `nulls: 'last'` fix.
  it('sorts null-date rows after every dated row, most recent first', async () => {
    const { campaign, filter } = await seedCampaignAndFilter()
    const svc = service.app.get(VoterFileFilterService)

    const nullDateRow = await service.prisma.outreach.create({
      data: {
        campaignId: campaign.id,
        voterFileFilterId: filter.id,
        outreachType: OutreachType.robocall,
        date: null,
      },
    })
    const olderTextRow = await service.prisma.outreach.create({
      data: {
        campaignId: campaign.id,
        voterFileFilterId: filter.id,
        outreachType: OutreachType.text,
        date: new Date('2026-06-01T00:00:00.000Z'),
      },
    })
    const newerTextRow = await service.prisma.outreach.create({
      data: {
        campaignId: campaign.id,
        voterFileFilterId: filter.id,
        outreachType: OutreachType.text,
        date: new Date('2026-07-01T00:00:00.000Z'),
      },
    })

    const result = await svc.findOutreachesByVoterFileFilterId(filter.id)

    expect(result.map((row) => row.id)).toEqual([
      newerTextRow.id,
      olderTextRow.id,
      nullDateRow.id,
    ])
  })

  // ENG-10776: legacy doorKnocking rows are never a real send on this
  // surface (the door-knock tool has its own model) — a null-date, null-name
  // one produced the "— / — / Door knocking" phantom row. nativeDoorKnocking
  // is a distinct, still-supported channel and must stay.
  it('excludes legacy doorKnocking rows but keeps nativeDoorKnocking rows', async () => {
    const { campaign, filter } = await seedCampaignAndFilter()
    const svc = service.app.get(VoterFileFilterService)

    await service.prisma.outreach.create({
      data: {
        campaignId: campaign.id,
        voterFileFilterId: filter.id,
        outreachType: OutreachType.doorKnocking,
        name: null,
        date: null,
      },
    })
    const nativeDoorKnockRow = await service.prisma.outreach.create({
      data: {
        campaignId: campaign.id,
        voterFileFilterId: filter.id,
        outreachType: OutreachType.nativeDoorKnocking,
        date: new Date('2026-06-01T00:00:00.000Z'),
      },
    })

    const result = await svc.findOutreachesByVoterFileFilterId(filter.id)

    expect(result.map((row) => row.id)).toEqual([nativeDoorKnockRow.id])
  })
})
