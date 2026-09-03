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
      aiContent: {},
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
    expect(res.data).toEqual({ contacts: 3, responded: 1, optedOut: 1 })
  })

  it('falls back to the purchase-time count when no rows exist', async () => {
    const row = await seedOutreach()
    const res = await getResults(row.id)
    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data).toEqual({ contacts: 1200, responded: 0, optedOut: 0 })
  })

  it('rejects non-text channels', async () => {
    const row = await seedOutreach({
      outreachType: OutreachType.socialMedia,
    })
    const res = await getResults(row.id)
    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
  })
})
