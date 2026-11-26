import { HttpStatus } from '@nestjs/common'
import { beforeEach, describe, expect, it } from 'vitest'
import { useTestService } from '@/test-service'
import { OutreachStatus, OutreachType } from '../../generated/prisma'

const service = useTestService()

let campaignId: number
let orgSlug: string

beforeEach(async () => {
  campaignId = 996
  orgSlug = `campaign-${campaignId}`
  await service.prisma.organization.create({
    data: { slug: orgSlug, ownerId: service.user.id, positionId: 'pos-1' },
  })
  await service.prisma.campaign.create({
    data: {
      id: campaignId,
      organizationSlug: orgSlug,
      userId: service.user.id,
      slug: 'jane-doe-results',
      details: { state: 'TX', zip: '78634' },
      data: {},
    },
  })
})

const seedOutreach = (
  overrides: Partial<{
    outreachType: OutreachType
    billableTextCount: number | null
  }> = {},
) =>
  service.prisma.outreach.create({
    data: {
      campaignId,
      outreachType: OutreachType.p2p,
      name: 'Likely voters — SMS',
      status: OutreachStatus.completed,
      projectId: 'peerly-job-1',
      billableTextCount: 1200,
      ...overrides,
    },
  })

const getResults = (id: number) =>
  service.client.get(`/v1/outreach/${id}/results`, {
    headers: { 'x-organization-slug': orgSlug },
  })

describe('GET /v1/outreach/:id/results', () => {
  it('counts recipients, responders, and opt-outs from interaction rows', async () => {
    const row = await seedOutreach()
    await service.prisma.contactInteractionText.createMany({
      data: [
        {
          organizationSlug: orgSlug,
          personId: 'p1',
          outreachId: row.id,
          occurredAt: new Date(),
          sourceEventId: 'e1',
          respondedAt: new Date(),
        },
        {
          organizationSlug: orgSlug,
          personId: 'p2',
          outreachId: row.id,
          occurredAt: new Date(),
          sourceEventId: 'e2',
          optedOutAt: new Date(),
        },
        {
          organizationSlug: orgSlug,
          personId: 'p3',
          outreachId: row.id,
          occurredAt: new Date(),
          sourceEventId: 'e3',
        },
      ],
    })

    const res = await getResults(row.id)
    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data).toEqual({
      contacts: 3,
      responded: 1,
      optedOut: 1,
      notDelivered: null,
    })
  })

  it('counts someone who replied and then opted out once, as opted out', async () => {
    const row = await seedOutreach()
    await service.prisma.contactInteractionText.createMany({
      data: [
        {
          organizationSlug: orgSlug,
          personId: 'p1',
          outreachId: row.id,
          occurredAt: new Date(),
          sourceEventId: 'e1',
          respondedAt: new Date(),
          optedOutAt: new Date(),
        },
        {
          organizationSlug: orgSlug,
          personId: 'p2',
          outreachId: row.id,
          occurredAt: new Date(),
          sourceEventId: 'e2',
          respondedAt: new Date(),
        },
      ],
    })

    const res = await getResults(row.id)
    expect(res.data).toMatchObject({ contacts: 2, responded: 1, optedOut: 1 })
  })

  it('falls back to the purchase-time count when no rows exist', async () => {
    const row = await seedOutreach()
    const res = await getResults(row.id)
    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data).toEqual({
      contacts: 1200,
      responded: 0,
      optedOut: 0,
      notDelivered: null,
    })
  })

  it('applies the failed share of receipts to the people texted', async () => {
    const row = await seedOutreach()
    // Receipts count messages, follow-ups included: 1,250 messages to the
    // 1,200 people, 50 of them failed.
    await service.prisma.outreachSmsDelivery.create({
      data: {
        outreachId: row.id,
        delivered: 1190,
        failed: 50,
        unconfirmed: 10,
        readAt: new Date(),
      },
    })

    const res = await getResults(row.id)

    expect(res.data).toEqual({
      contacts: 1200,
      responded: 0,
      optedOut: 0,
      notDelivered: 48,
    })
  })

  it('never counts someone who wrote back as not delivered', async () => {
    const row = await seedOutreach()
    const person = (personId: string, extra: object) => ({
      organizationSlug: orgSlug,
      personId,
      outreachId: row.id,
      occurredAt: new Date(),
      sourceEventId: personId,
      ...extra,
    })
    await service.prisma.contactInteractionText.createMany({
      data: [
        person('p1', { respondedAt: new Date() }),
        person('p2', { respondedAt: new Date() }),
        person('p3', { optedOutAt: new Date() }),
        person('p4', {}),
      ],
    })
    await service.prisma.outreachSmsDelivery.create({
      data: {
        outreachId: row.id,
        delivered: 1,
        failed: 3,
        unconfirmed: 0,
        readAt: new Date(),
      },
    })

    const res = await getResults(row.id)

    // 3 of 4 messages failed, but three of the four people wrote back.
    expect(res.data.notDelivered).toBe(1)
  })

  it('rejects non-text channels', async () => {
    const row = await seedOutreach({
      outreachType: OutreachType.socialMedia,
    })
    const res = await getResults(row.id)
    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
  })
})
