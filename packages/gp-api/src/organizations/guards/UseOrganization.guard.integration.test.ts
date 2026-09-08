import { useTestService } from '@/test-service'
import { ClerkInvitationsService } from '@/vendors/clerk/services/clerkInvitations.service'
import { describe, expect, it, vi } from 'vitest'
import { OrganizationRole } from '../../generated/prisma'

const service = useTestService()

/**
 * Integration tests proving OrganizationRoleGuard actually runs after
 * UseOrganizationGuard in @UseOrganization()'s real guard chain, through a
 * real HTTP request — the guard-level unit tests mock resolveRole directly
 * and never invoke OrganizationRoleGuard, so they can't catch it being
 * dropped from the chain. Tests against GET /v1/organizations/team, which
 * is @UseOrganization() with neither @AllowVolunteer() nor @OwnerOnly().
 */
describe('UseOrganization guard (integration)', () => {
  const stubClerkInvitations = () => service.app.get(ClerkInvitationsService)

  // GET team always lists pending invites via Clerk; stub it to an empty
  // page so these tests don't depend on Clerk being reachable.
  const noPendingInvites = () =>
    vi
      .spyOn(stubClerkInvitations(), 'listPendingTeamInvitations')
      .mockResolvedValue([])

  it('returns 403 for a volunteer membership row (role guard denies, not the scoping guard)', async () => {
    const owner = await service.prisma.user.create({
      data: { email: 'org-owner-volunteer-test@goodparty.org' },
    })
    const org = await service.prisma.organization.create({
      data: { slug: 'org-volunteer-test', ownerId: owner.id },
    })
    await service.prisma.organizationMembership.create({
      data: {
        organizationSlug: org.slug,
        userId: service.user.id,
        role: OrganizationRole.volunteer,
      },
    })
    noPendingInvites()

    const result = await service.client.get('/v1/organizations/team', {
      headers: { 'x-organization-slug': org.slug },
    })

    expect(result.status).toBe(403)
  })

  it('returns 200 for the owner (control)', async () => {
    const org = await service.prisma.organization.create({
      data: { slug: 'org-owner-test', ownerId: service.user.id },
    })
    noPendingInvites()

    const result = await service.client.get('/v1/organizations/team', {
      headers: { 'x-organization-slug': org.slug },
    })

    expect(result.status).toBe(200)
  })

  it('returns 200 for a campaignAdmin member (control)', async () => {
    const owner = await service.prisma.user.create({
      data: { email: 'org-owner-admin-test@goodparty.org' },
    })
    const org = await service.prisma.organization.create({
      data: { slug: 'org-admin-test', ownerId: owner.id },
    })
    await service.prisma.organizationMembership.create({
      data: {
        organizationSlug: org.slug,
        userId: service.user.id,
        role: OrganizationRole.campaignAdmin,
      },
    })
    noPendingInvites()

    const result = await service.client.get('/v1/organizations/team', {
      headers: { 'x-organization-slug': org.slug },
    })

    expect(result.status).toBe(200)
  })
})
