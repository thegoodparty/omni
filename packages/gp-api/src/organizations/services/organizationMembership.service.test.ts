import { describe, expect, it } from 'vitest'
import { OrganizationRole } from '../../generated/prisma'
import { useTestService } from '@/test-service'
import { OrganizationMembershipService } from './organizationMembership.service'

const service = useTestService()

describe('OrganizationMembershipService.resolveRole', () => {
  it('resolves owner via the ownerId fallback, with no membership row', async () => {
    const org = await service.prisma.organization.create({
      data: { slug: 'resolve-owner', ownerId: service.user.id },
    })

    const membershipService = service.app.get(OrganizationMembershipService)
    const resolved = await membershipService.resolveRole(
      org.slug,
      service.user.id,
    )

    expect(resolved).toEqual({
      role: OrganizationRole.owner,
      organization: org,
    })
  })

  it('resolves a membership row for a non-owner', async () => {
    const org = await service.prisma.organization.create({
      data: { slug: 'resolve-member', ownerId: service.user.id },
    })
    const member = await service.prisma.user.create({
      data: { email: 'resolve-member@goodparty.org' },
    })
    await service.prisma.organizationMembership.create({
      data: {
        organizationSlug: org.slug,
        userId: member.id,
        role: OrganizationRole.campaignAdmin,
      },
    })

    const membershipService = service.app.get(OrganizationMembershipService)
    const resolved = await membershipService.resolveRole(org.slug, member.id)

    expect(resolved).toEqual({
      role: OrganizationRole.campaignAdmin,
      organization: org,
    })
  })

  it('returns null for a non-member with no membership row', async () => {
    const org = await service.prisma.organization.create({
      data: { slug: 'resolve-non-member', ownerId: service.user.id },
    })
    const stranger = await service.prisma.user.create({
      data: { email: 'resolve-stranger@goodparty.org' },
    })

    const membershipService = service.app.get(OrganizationMembershipService)
    const resolved = await membershipService.resolveRole(org.slug, stranger.id)

    expect(resolved).toBeNull()
  })

  it('returns null when the organization does not exist', async () => {
    const membershipService = service.app.get(OrganizationMembershipService)
    const resolved = await membershipService.resolveRole(
      'nonexistent-org',
      service.user.id,
    )

    expect(resolved).toBeNull()
  })

  // Rule ordering (ENG-10818): owner fallback wins even if a stray
  // membership row exists for the same (organizationSlug, userId) — the
  // owner path never reads the membership table.
  it('resolves owner over a stray membership row on the same org', async () => {
    const org = await service.prisma.organization.create({
      data: { slug: 'resolve-owner-stray', ownerId: service.user.id },
    })
    await service.prisma.organizationMembership.create({
      data: {
        organizationSlug: org.slug,
        userId: service.user.id,
        role: OrganizationRole.volunteer,
      },
    })

    const membershipService = service.app.get(OrganizationMembershipService)
    const resolved = await membershipService.resolveRole(
      org.slug,
      service.user.id,
    )

    expect(resolved?.role).toBe(OrganizationRole.owner)
  })
})
