import { useTestService } from '@/test-service'
import { describe, expect, it } from 'vitest'
import { OrganizationRole } from '../../generated/prisma'

const service = useTestService()

/**
 * Integration tests for the UseCampaign guard's resolution paths.
 * Tests against GET /v1/campaigns/mine which uses @UseCampaign() and returns the campaign directly,
 * allowing us to verify the correct campaign was resolved.
 */
describe('UseCampaign guard (integration)', () => {
  async function createCampaignWithOrg(slugSuffix: string) {
    const org = await service.prisma.organization.create({
      data: {
        slug: `campaign-org-${slugSuffix}`,
        ownerId: service.user.id,
      },
    })

    const campaign = await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: `test-campaign-${slugSuffix}`,
        details: {},
        organizationSlug: org.slug,
      },
    })

    return { org, campaign }
  }

  describe('no header', () => {
    it('returns 404 when no org header is provided (even if user has a campaign)', async () => {
      await createCampaignWithOrg('no-header')

      const result = await service.client.get('/v1/campaigns/mine')

      expect(result.status).toBe(404)
    })
  })

  describe('x-organization-slug header', () => {
    it('resolves campaign via organization header', async () => {
      const { org, campaign } = await createCampaignWithOrg('header-test')

      const result = await service.client.get('/v1/campaigns/mine', {
        headers: { 'x-organization-slug': org.slug },
      })

      expect(result.status).toBe(200)
      expect(result.data.slug).toBe(campaign.slug)
      expect(result.data.id).toBe(campaign.id)
    })

    it('resolves the correct campaign when user has multiple orgs', async () => {
      const { org: org1 } = await createCampaignWithOrg('multi-1')
      const { org: org2, campaign: campaign2 } =
        await createCampaignWithOrg('multi-2')

      // Request with org2 header should resolve campaign2, not campaign1
      const result = await service.client.get('/v1/campaigns/mine', {
        headers: { 'x-organization-slug': org2.slug },
      })

      expect(result.status).toBe(200)
      expect(result.data.slug).toBe(campaign2.slug)
      expect(result.data.id).toBe(campaign2.id)

      // Request with org1 header should resolve campaign1
      const result1 = await service.client.get('/v1/campaigns/mine', {
        headers: { 'x-organization-slug': org1.slug },
      })

      expect(result1.status).toBe(200)
      expect(result1.data.slug).toBe('test-campaign-multi-1')
    })

    it('returns 404 when org slug does not exist', async () => {
      await createCampaignWithOrg('exists-but-not-matched')

      const result = await service.client.get('/v1/campaigns/mine', {
        headers: { 'x-organization-slug': 'nonexistent-slug' },
      })

      expect(result.status).toBe(404)
    })

    it('returns 404 when org has no campaign', async () => {
      const orgWithoutCampaign = await service.prisma.organization.create({
        data: {
          slug: 'no-campaign-org',
          ownerId: service.user.id,
        },
      })

      await createCampaignWithOrg('unrelated')

      const result = await service.client.get('/v1/campaigns/mine', {
        headers: { 'x-organization-slug': orgWithoutCampaign.slug },
      })

      expect(result.status).toBe(404)
    })

    it('resolves the campaign for a campaignAdmin member, not just the owner', async () => {
      // The owner (not service.user) owns both the org and the campaign —
      // proves the campaign lookup dropped its userId predicate, not just
      // the org's, since Campaign.userId here is the owner's id.
      const owner = await service.prisma.user.create({
        data: { email: 'campaign-owner-member-test@goodparty.org' },
      })
      const org = await service.prisma.organization.create({
        data: { slug: 'campaign-org-member-test', ownerId: owner.id },
      })
      const campaign = await service.prisma.campaign.create({
        data: {
          userId: owner.id,
          slug: 'test-campaign-member-test',
          organizationSlug: org.slug,
        },
      })
      await service.prisma.organizationMembership.create({
        data: {
          organizationSlug: org.slug,
          userId: service.user.id,
          role: OrganizationRole.campaignAdmin,
        },
      })

      const result = await service.client.get('/v1/campaigns/mine', {
        headers: { 'x-organization-slug': org.slug },
      })

      expect(result.status).toBe(200)
      expect(result.data.slug).toBe(campaign.slug)
    })

    // Phase 1.5: UseCampaignGuard now resolves and attaches a volunteer
    // membership like any other member — this route carries no
    // @AllowVolunteer(), so OrganizationRoleGuard (next in the chain) is
    // what denies the volunteer, with a 403 (they know the org exists),
    // not the 404 a non-member gets.
    it('returns 403 for a volunteer membership row (role guard denies, not the scoping guard)', async () => {
      const owner = await service.prisma.user.create({
        data: { email: 'campaign-owner-volunteer-test@goodparty.org' },
      })
      const org = await service.prisma.organization.create({
        data: { slug: 'campaign-org-volunteer-test', ownerId: owner.id },
      })
      await service.prisma.campaign.create({
        data: {
          userId: owner.id,
          slug: 'test-campaign-volunteer-test',
          organizationSlug: org.slug,
        },
      })
      await service.prisma.organizationMembership.create({
        data: {
          organizationSlug: org.slug,
          userId: service.user.id,
          role: OrganizationRole.volunteer,
        },
      })

      const result = await service.client.get('/v1/campaigns/mine', {
        headers: { 'x-organization-slug': org.slug },
      })

      expect(result.status).toBe(403)
    })

    it('returns 404 when org belongs to another user', async () => {
      const otherUser = await service.prisma.user.create({
        data: { email: 'other@goodparty.org' },
      })

      const otherOrg = await service.prisma.organization.create({
        data: {
          slug: 'other-user-org',
          ownerId: otherUser.id,
        },
      })

      const result = await service.client.get('/v1/campaigns/mine', {
        headers: { 'x-organization-slug': otherOrg.slug },
      })

      expect(result.status).toBe(404)
    })
  })
})
