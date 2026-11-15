import { randomUUID } from 'node:crypto'
import { HttpStatus } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FeaturesService } from '@/features/services/features.service'
import { WIN_SMS_PREVIEW_EDIT_FLAG } from '@/shared/util/winSmsPreviewEditFlag.util'
import { useTestService } from '@/test-service'
import {
  OutreachStatus,
  OutreachType,
  PollIndividualMessageSender,
} from '../../generated/prisma'

const service = useTestService()

const isFeatureEnabled = vi.fn()

let orgSlug: string
let campaignId: number

beforeEach(async () => {
  isFeatureEnabled.mockReset().mockResolvedValue(true)
  vi.spyOn(
    service.app.get(FeaturesService),
    'isFeatureEnabled',
  ).mockImplementation(isFeatureEnabled)

  campaignId = 996
  orgSlug = `campaign-${campaignId}`
  await service.prisma.organization.create({
    data: { slug: orgSlug, ownerId: service.user.id },
  })
  await service.prisma.campaign.create({
    data: {
      id: campaignId,
      organizationSlug: orgSlug,
      userId: service.user.id,
      slug: 'jane-doe-replies',
      details: { state: 'TX', zip: '78634' },
      data: {},
    },
  })
})

const seedSend = (overrides: { campaignId?: number | null } = {}) =>
  service.prisma.outreach.create({
    data: {
      campaignId,
      organizationSlug: orgSlug,
      outreachType: OutreachType.p2p,
      name: 'Likely voters SMS',
      status: OutreachStatus.completed,
      ...overrides,
    },
  })

const seedReply = (outreachId: number, content: string, sentAt: Date) =>
  service.prisma.pollIndividualMessage.create({
    data: {
      id: randomUUID(),
      outreachId,
      personId: randomUUID(),
      personCellPhone: '+13035550100',
      sentAt,
      isOptOut: false,
      sender: PollIndividualMessageSender.CONSTITUENT,
      content,
    },
  })

const getReplies = (id: number) =>
  service.client.get(`/v1/outreach/${id}/replies`, {
    headers: { 'x-organization-slug': orgSlug },
    validateStatus: () => true,
  })

describe('GET /v1/outreach/:id/replies', () => {
  it("returns the caller's Win replies newest first", async () => {
    const send = await seedSend()
    await seedReply(send.id, 'Fix Elm first', new Date('2026-11-01T10:00:00Z'))
    await seedReply(
      send.id,
      'Thanks for asking',
      new Date('2026-11-02T10:00:00Z'),
    )

    const res = await getReplies(send.id)

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data.total).toBe(2)
    expect(res.data.replies.map((r: { content: string }) => r.content)).toEqual(
      ['Thanks for asking', 'Fix Elm first'],
    )
    expect(isFeatureEnabled).toHaveBeenCalledWith(
      expect.objectContaining({ feature: WIN_SMS_PREVIEW_EDIT_FLAG }),
    )
  })

  it("404s another campaign's send", async () => {
    const otherSlug = 'campaign-997'
    await service.prisma.organization.create({
      data: { slug: otherSlug, ownerId: service.user.id },
    })
    const other = await service.prisma.campaign.create({
      data: {
        id: 997,
        organizationSlug: otherSlug,
        userId: service.user.id,
        slug: 'other-replies',
        details: { state: 'TX', zip: '78634' },
        data: {},
      },
    })
    const send = await seedSend({ campaignId: other.id })
    await seedReply(send.id, 'Not yours', new Date())

    const res = await getReplies(send.id)

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })

  it('404s when the flag is off', async () => {
    isFeatureEnabled.mockResolvedValue(false)
    const send = await seedSend()
    await seedReply(send.id, 'Fix Elm first', new Date())

    const res = await getReplies(send.id)

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })
})
