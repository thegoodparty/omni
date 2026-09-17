import { beforeEach, describe, expect, it } from 'vitest'
import { useTestService } from '@/test-service'
import { OutreachType } from '../../generated/prisma'

// ENG-10976: the Outreach spine became org-scoped so a Serve elected-office
// org (no campaign row) can persist an outreach row. These tests exercise
// the DB-level invariant directly — no service writes a campaign-less row
// yet, so there is no HTTP path to drive this through.
const service = useTestService()

let orgSlug: string

beforeEach(async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  orgSlug = `campaign-org-scope-${suffix}`

  await service.prisma.organization.create({
    data: { slug: orgSlug, ownerId: service.user.id },
  })
})

describe('Outreach org scope (ENG-10976)', () => {
  it('creates an org-scoped-only row when campaignId is null', async () => {
    const outreach = await service.prisma.outreach.create({
      data: {
        organizationSlug: orgSlug,
        outreachType: OutreachType.socialMedia,
      },
    })

    expect(outreach.campaignId).toBeNull()
    expect(outreach.organizationSlug).toBe(orgSlug)
  })

  it('rejects a row with neither campaignId nor organizationSlug', async () => {
    await expect(
      service.prisma.outreach.create({
        data: { outreachType: OutreachType.socialMedia },
      }),
    ).rejects.toThrow(/outreach_scope_check/)
  })

  it('deletes an org-only row when its organization is deleted, instead of violating the CHECK constraint', async () => {
    const outreach = await service.prisma.outreach.create({
      data: {
        organizationSlug: orgSlug,
        outreachType: OutreachType.socialMedia,
      },
    })

    await expect(
      service.prisma.organization.delete({ where: { slug: orgSlug } }),
    ).resolves.toBeDefined()

    const persisted = await service.prisma.outreach.findUnique({
      where: { id: outreach.id },
    })
    expect(persisted).toBeNull()
  })

  it('still cascade-deletes a campaign-scoped row via the campaign relation when its organization is deleted', async () => {
    const campaign = await service.prisma.campaign.create({
      data: {
        organizationSlug: orgSlug,
        userId: service.user.id,
        slug: `org-scope-campaign-${orgSlug}`,
        details: {},
        data: {},
        aiContent: {},
      },
    })
    const outreach = await service.prisma.outreach.create({
      data: {
        campaignId: campaign.id,
        organizationSlug: orgSlug,
        outreachType: OutreachType.nativePhoneBanking,
      },
    })

    await expect(
      service.prisma.organization.delete({ where: { slug: orgSlug } }),
    ).resolves.toBeDefined()

    const persisted = await service.prisma.outreach.findUnique({
      where: { id: outreach.id },
    })
    expect(persisted).toBeNull()
  })
})
