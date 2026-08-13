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
      outreachType: OutreachType.robocall,
      organizationSlug: org.slug,
    },
  })
  return { org, outreach }
}

const expectUniqueRejection = async (create: Promise<object>) => {
  const err = await create.then(() => null).catch((e: Error) => e)
  expect(isUniqueConstraintError(err)).toBe(true)
}

describe('ContactInteractionRobocall model', () => {
  it('rejects a duplicate (outreachId, personId)', async () => {
    const { org, outreach } = await seedOutreach('crm-robo-per-person')
    const data = {
      organizationSlug: org.slug,
      personId: 'person-1',
      occurredAt: new Date(),
      outreachId: outreach.id,
      sourceCallId: 'call-1',
    }
    await service.prisma.contactInteractionRobocall.create({ data })

    await expectUniqueRejection(
      service.prisma.contactInteractionRobocall.create({
        data: { ...data, sourceCallId: 'call-2' },
      }),
    )
  })

  it('rejects a duplicate (organizationSlug, sourceCallId)', async () => {
    const { org, outreach } = await seedOutreach('crm-robo-idempotency')
    const data = {
      organizationSlug: org.slug,
      personId: 'person-1',
      occurredAt: new Date(),
      outreachId: outreach.id,
      sourceCallId: 'call-1',
    }
    await service.prisma.contactInteractionRobocall.create({ data })

    await expectUniqueRejection(
      service.prisma.contactInteractionRobocall.create({
        data: { ...data, personId: 'person-2' },
      }),
    )
  })

  it('creates and reads back a manual row with a null outreachId', async () => {
    const org = await service.prisma.organization.create({
      data: { slug: 'crm-robo-manual', ownerId: service.user.id },
    })
    const created = await service.prisma.contactInteractionRobocall.create({
      data: {
        organizationSlug: org.slug,
        personId: 'person-1',
        occurredAt: new Date(),
        outreachId: null,
        manual: true,
        note: 'Left a voicemail in person, logging by hand',
      },
    })

    expect(created.outreachId).toBeNull()
    expect(created.manual).toBe(true)
    expect(created.note).toBe('Left a voicemail in person, logging by hand')
  })

  it('allows two manual rows for the same (org, person)', async () => {
    const org = await service.prisma.organization.create({
      data: { slug: 'crm-robo-manual-dup', ownerId: service.user.id },
    })
    const data = {
      organizationSlug: org.slug,
      personId: 'person-1',
      occurredAt: new Date(),
      outreachId: null,
      manual: true,
    }
    await service.prisma.contactInteractionRobocall.create({ data })
    // Postgres treats NULLs as distinct, so a second manual log for the
    // same person never collides on (outreachId, personId).
    await service.prisma.contactInteractionRobocall.create({ data })

    const count = await service.prisma.contactInteractionRobocall.count({
      where: { organizationSlug: org.slug },
    })
    expect(count).toBe(2)
  })
})
