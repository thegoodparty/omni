import { useTestService } from '@/test-service'
import { describe, expect, it } from 'vitest'
import { OrganizationRole } from '../../generated/prisma'

const service = useTestService()

// ENG-11025: membership resolution in UseEngagementContextGuard. The owner
// paths here are byte-identical to pre-membership behavior (the guard's
// owner branch is unchanged); these tests cover the new member/volunteer/
// non-member matrix across the Win (campaign) and Serve (elected office)
// branches.
describe('ContactEngagement guard membership matrix', () => {
  async function createWinOrgOwnedBy(userId: number, slugSuffix: string) {
    const org = await service.prisma.organization.create({
      data: { slug: `engagement-win-${slugSuffix}`, ownerId: userId },
    })
    await service.prisma.campaign.create({
      data: {
        userId,
        slug: `engagement-campaign-${slugSuffix}`,
        organizationSlug: org.slug,
      },
    })
    return org
  }

  // ElectedOffice.campaignId is an FK to the Win campaign the Serve account
  // grew from — a separate Organization/Campaign pair from the eo- org
  // itself (mirrors the fixture setup in contactEngagement.routes.test.ts).
  async function createEoOrgOwnedBy(userId: number, slugSuffix: string) {
    const winOrg = await service.prisma.organization.create({
      data: { slug: `engagement-eo-base-${slugSuffix}`, ownerId: userId },
    })
    const campaign = await service.prisma.campaign.create({
      data: {
        userId,
        slug: `engagement-eo-base-campaign-${slugSuffix}`,
        organizationSlug: winOrg.slug,
      },
    })
    const eoOrg = await service.prisma.organization.create({
      data: { slug: `eo-engagement-${slugSuffix}`, ownerId: userId },
    })
    await service.prisma.electedOffice.create({
      data: {
        userId,
        campaignId: campaign.id,
        organizationSlug: eoOrg.slug,
      },
    })
    return eoOrg
  }

  it('admits a campaignAdmin member to the Win CRM engagement context', async () => {
    const owner = await service.prisma.user.create({
      data: { email: 'engagement-owner-win@goodparty.org' },
    })
    const org = await createWinOrgOwnedBy(owner.id, 'admin')
    await service.prisma.organizationMembership.create({
      data: {
        organizationSlug: org.slug,
        userId: service.user.id,
        role: OrganizationRole.campaignAdmin,
      },
    })

    const result = await service.client.get(
      '/v1/contact-engagement/person-1/activities',
      { headers: { 'x-organization-slug': org.slug } },
    )

    expect(result.status).toBe(200)
  })

  // Unlike UseOrganization/UseCampaign (which now attach a volunteer's role
  // and defer to OrganizationRoleGuard), UseEngagementContextGuard keeps its
  // own volunteer denial — the CRM stays volunteer-denying permanently, not
  // as a Phase 1.5 stopgap.
  it('denies a volunteer the Win CRM engagement context', async () => {
    const owner = await service.prisma.user.create({
      data: { email: 'engagement-owner-volunteer@goodparty.org' },
    })
    const org = await createWinOrgOwnedBy(owner.id, 'volunteer')
    await service.prisma.organizationMembership.create({
      data: {
        organizationSlug: org.slug,
        userId: service.user.id,
        role: OrganizationRole.volunteer,
      },
    })

    const result = await service.client.get(
      '/v1/contact-engagement/person-1/activities',
      { headers: { 'x-organization-slug': org.slug } },
    )

    expect(result.status).toBe(404)
  })

  it('denies a non-member exactly as today', async () => {
    const owner = await service.prisma.user.create({
      data: { email: 'engagement-owner-nonmember@goodparty.org' },
    })
    const org = await createWinOrgOwnedBy(owner.id, 'nonmember')

    const result = await service.client.get(
      '/v1/contact-engagement/person-1/activities',
      { headers: { 'x-organization-slug': org.slug } },
    )

    expect(result.status).toBe(404)
  })

  it('denies a campaignAdmin member the Serve (eo-) engagement context', async () => {
    const owner = await service.prisma.user.create({
      data: { email: 'engagement-owner-eo@goodparty.org' },
    })
    const org = await createEoOrgOwnedBy(owner.id, 'admin')
    await service.prisma.organizationMembership.create({
      data: {
        organizationSlug: org.slug,
        userId: service.user.id,
        role: OrganizationRole.campaignAdmin,
      },
    })

    const result = await service.client.get(
      '/v1/contact-engagement/person-1/activities',
      { headers: { 'x-organization-slug': org.slug } },
    )

    expect(result.status).toBe(404)
  })
})
