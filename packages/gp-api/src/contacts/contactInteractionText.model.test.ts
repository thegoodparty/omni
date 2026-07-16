import { describe, expect, it } from 'vitest'
import { OutreachType } from '../generated/prisma'
import { isUniqueConstraintError } from '@/prisma/util/prismaErrors.util'
import { useTestService } from '@/test-service'

const service = useTestService()

const seedOutreach = async (slug: string) => {
  const org = await service.prisma.organization.create({
    data: { slug, ownerId: service.user.id },
  })
  const campaign = await service.prisma.campaign.create({
    data: {
      userId: service.user.id,
      slug: `${slug}-campaign`,
      organizationSlug: org.slug,
    },
  })
  const outreach = await service.prisma.outreach.create({
    data: {
      campaignId: campaign.id,
      outreachType: OutreachType.text,
      organizationSlug: org.slug,
    },
  })
  return { org, outreach }
}

const expectUniqueRejection = async (create: Promise<object>) => {
  const err = await create.then(() => null).catch((e: Error) => e)
  expect(isUniqueConstraintError(err)).toBe(true)
}

describe('ContactInteractionText model', () => {
  it('rejects a duplicate (outreachId, personId)', async () => {
    const { org, outreach } = await seedOutreach('crm-text-per-person')
    const data = {
      organizationSlug: org.slug,
      personId: 'person-1',
      occurredAt: new Date(),
      outreachId: outreach.id,
      sourceEventId: 'evt-1',
    }
    await service.prisma.contactInteractionText.create({ data })

    await expectUniqueRejection(
      service.prisma.contactInteractionText.create({
        data: { ...data, sourceEventId: 'evt-2' },
      }),
    )
  })

  it('rejects a duplicate (organizationSlug, sourceEventId)', async () => {
    const { org, outreach } = await seedOutreach('crm-text-idempotency')
    const data = {
      organizationSlug: org.slug,
      personId: 'person-1',
      occurredAt: new Date(),
      outreachId: outreach.id,
      sourceEventId: 'evt-1',
    }
    await service.prisma.contactInteractionText.create({ data })

    await expectUniqueRejection(
      service.prisma.contactInteractionText.create({
        data: { ...data, personId: 'person-2' },
      }),
    )
  })

  it('allows multiple rows with a null sourceEventId', async () => {
    const { org, outreach } = await seedOutreach('crm-text-null-source')
    const data = {
      organizationSlug: org.slug,
      occurredAt: new Date(),
      outreachId: outreach.id,
      sourceEventId: null,
    }
    await service.prisma.contactInteractionText.create({
      data: { ...data, personId: 'person-1' },
    })
    // Postgres treats NULLs as distinct, so unsourced rows never collide.
    await service.prisma.contactInteractionText.create({
      data: { ...data, personId: 'person-2' },
    })

    const count = await service.prisma.contactInteractionText.count({
      where: { organizationSlug: org.slug },
    })
    expect(count).toBe(2)
  })
})
