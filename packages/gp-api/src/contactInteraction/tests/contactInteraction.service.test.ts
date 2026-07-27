import { useTestService } from '@/test-service'
import {
  DoorKnockOutcome,
  OutreachType,
  SupportAnswer,
} from '@/generated/prisma'
import { beforeEach, describe, expect, it } from 'vitest'
import { ContactInteractionDoorKnockService } from '../services/contactInteractionDoorKnock.service'
import { ContactInteractionRobocallService } from '../services/contactInteractionRobocall.service'
import { ContactInteractionTextService } from '../services/contactInteractionText.service'

const service = useTestService()

describe('contact interaction services', () => {
  let doorKnocks: ContactInteractionDoorKnockService
  let texts: ContactInteractionTextService
  let robocalls: ContactInteractionRobocallService

  const seedOrganization = async (slug: string) => {
    await service.prisma.organization.create({
      data: { slug, ownerId: service.user.id },
    })
    return slug
  }

  // Campaign.organizationSlug is unique, so one campaign per org; outreaches
  // hang off it per channel.
  const seedOutreach = async (
    organizationSlug: string,
    outreachType: OutreachType,
  ) => {
    const campaign = await service.prisma.campaign.upsert({
      where: { organizationSlug },
      create: {
        userId: service.user.id,
        slug: `campaign-${organizationSlug}`,
        organizationSlug,
      },
      update: {},
    })
    const outreach = await service.prisma.outreach.create({
      data: { campaignId: campaign.id, outreachType, organizationSlug },
    })
    return outreach.id
  }

  beforeEach(() => {
    doorKnocks = service.app.get(ContactInteractionDoorKnockService)
    texts = service.app.get(ContactInteractionTextService)
    robocalls = service.app.get(ContactInteractionRobocallService)
  })

  it('upserts a door knock idempotently on (organizationSlug, sourceId)', async () => {
    const organizationSlug = await seedOrganization('org-dk-idempotent')

    const first = await doorKnocks.recordIdempotent({
      organizationSlug,
      personId: 'person-1',
      occurredAt: new Date('2026-06-01T15:00:00.000Z'),
      outcome: DoorKnockOutcome.not_home,
      sourceId: 'route-42-stop-7',
    })

    const second = await doorKnocks.recordIdempotent({
      organizationSlug,
      personId: 'person-1',
      occurredAt: new Date('2026-06-01T17:30:00.000Z'),
      outcome: DoorKnockOutcome.answered,
      supportAnswer: SupportAnswer.supporter,
      note: 'came back later, strong supporter',
      sourceId: 'route-42-stop-7',
    })

    expect(second.id).toBe(first.id)
    expect(second).toMatchObject({
      occurredAt: new Date('2026-06-01T17:30:00.000Z'),
      outcome: DoorKnockOutcome.answered,
      supportAnswer: SupportAnswer.supporter,
      note: 'came back later, strong supporter',
    })

    const rows = await doorKnocks.findMany({ where: { organizationSlug } })
    expect(rows).toHaveLength(1)
  })

  it('does not dedupe manual door knocks (null sourceId) with create', async () => {
    const organizationSlug = await seedOrganization('org-dk-manual')

    const log = () =>
      doorKnocks.create({
        organizationSlug,
        personId: 'person-2',
        occurredAt: new Date('2026-06-02T12:00:00.000Z'),
        outcome: DoorKnockOutcome.refused_to_engage,
        manual: true,
      })
    await log()
    await log()

    const rows = await doorKnocks.findMany({ where: { organizationSlug } })
    expect(rows).toHaveLength(2)
  })

  it('re-running an overlapping text batch skips (outreachId, personId) duplicates', async () => {
    const organizationSlug = await seedOrganization('org-text-batch')
    const outreachId = await seedOutreach(organizationSlug, OutreachType.text)
    const occurredAt = new Date('2026-06-03T18:00:00.000Z')

    const row = (personId: string) => ({
      organizationSlug,
      personId,
      occurredAt,
      outreachId,
    })

    const first = await texts.createManyIdempotent([row('p-1'), row('p-2')])
    expect(first.count).toBe(2)

    const rerun = await texts.createManyIdempotent([
      row('p-1'),
      row('p-2'),
      row('p-3'),
    ])
    expect(rerun.count).toBe(1)

    const rows = await texts.findMany({ where: { outreachId } })
    expect(rows).toHaveLength(3)
    expect(rows.map((r) => r.personId).sort()).toEqual(['p-1', 'p-2', 'p-3'])
  })

  it('re-running an overlapping robocall batch skips (outreachId, personId) duplicates', async () => {
    const organizationSlug = await seedOrganization('org-robo-batch')
    const outreachId = await seedOutreach(
      organizationSlug,
      OutreachType.robocall,
    )
    const occurredAt = new Date('2026-06-04T18:00:00.000Z')

    const row = (personId: string) => ({
      organizationSlug,
      personId,
      occurredAt,
      outreachId,
    })

    await robocalls.createManyIdempotent([row('p-1')])
    const rerun = await robocalls.createManyIdempotent([row('p-1'), row('p-2')])
    expect(rerun.count).toBe(1)

    const rows = await robocalls.findMany({ where: { outreachId } })
    expect(rows).toHaveLength(2)
  })

  it('deleting the organization cascades away its interaction rows', async () => {
    const organizationSlug = await seedOrganization('org-cascade')
    const outreachId = await seedOutreach(organizationSlug, OutreachType.text)
    const robocallOutreachId = await seedOutreach(
      organizationSlug,
      OutreachType.robocall,
    )
    const occurredAt = new Date('2026-06-05T12:00:00.000Z')

    await doorKnocks.recordIdempotent({
      organizationSlug,
      personId: 'person-3',
      occurredAt,
      outcome: DoorKnockOutcome.answered,
      sourceId: 'route-1-stop-1',
    })
    await texts.createManyIdempotent([
      { organizationSlug, personId: 'person-3', occurredAt, outreachId },
    ])
    await robocalls.createManyIdempotent([
      {
        organizationSlug,
        personId: 'person-3',
        occurredAt,
        outreachId: robocallOutreachId,
      },
    ])

    await service.prisma.organization.delete({
      where: { slug: organizationSlug },
    })

    expect(await doorKnocks.count({ where: { organizationSlug } })).toBe(0)
    expect(await texts.count({ where: { organizationSlug } })).toBe(0)
    expect(await robocalls.count({ where: { organizationSlug } })).toBe(0)
  })
})
