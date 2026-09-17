import { describe, expect, it } from 'vitest'
import { OrganizationRole } from '../generated/prisma'
import { isUniqueConstraintError } from '@/prisma/util/prismaErrors.util'
import { useTestService } from '@/test-service'

const service = useTestService()

describe('OrganizationMembership model', () => {
  it('rejects a duplicate (organizationSlug, userId)', async () => {
    const org = await service.prisma.organization.create({
      data: { slug: 'membership-idempotency', ownerId: service.user.id },
    })
    const otherUser = await service.prisma.user.create({
      data: { email: 'member-dup@goodparty.org' },
    })
    const data = {
      organizationSlug: org.slug,
      userId: otherUser.id,
      role: OrganizationRole.campaignAdmin,
    }
    await service.prisma.organizationMembership.create({ data })

    const secondCreate = service.prisma.organizationMembership
      .create({ data: { ...data, role: OrganizationRole.volunteer } })
      .then(() => null)
      .catch((err: Error) => err)

    expect(isUniqueConstraintError(await secondCreate)).toBe(true)
  })

  it('cascades on organization delete', async () => {
    const org = await service.prisma.organization.create({
      data: { slug: 'membership-org-cascade', ownerId: service.user.id },
    })
    const member = await service.prisma.user.create({
      data: { email: 'member-org-cascade@goodparty.org' },
    })
    await service.prisma.organizationMembership.create({
      data: {
        organizationSlug: org.slug,
        userId: member.id,
        role: OrganizationRole.campaignAdmin,
      },
    })

    await service.prisma.organization.delete({ where: { slug: org.slug } })

    const remaining = await service.prisma.organizationMembership.findMany({
      where: { organizationSlug: org.slug },
    })
    expect(remaining).toHaveLength(0)
  })

  it('cascades on user delete', async () => {
    const org = await service.prisma.organization.create({
      data: { slug: 'membership-user-cascade', ownerId: service.user.id },
    })
    const member = await service.prisma.user.create({
      data: { email: 'member-user-cascade@goodparty.org' },
    })
    await service.prisma.organizationMembership.create({
      data: {
        organizationSlug: org.slug,
        userId: member.id,
        role: OrganizationRole.volunteer,
      },
    })

    await service.prisma.user.delete({ where: { id: member.id } })

    const remaining = await service.prisma.organizationMembership.findMany({
      where: { userId: member.id },
    })
    expect(remaining).toHaveLength(0)
  })
})
