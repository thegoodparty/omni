import { subMinutes } from 'date-fns'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import {
  OutreachEmailPauseReason,
  OutreachEmailRecipientStatus,
  OutreachStatus,
  UserRole,
} from '../../generated/prisma'
import { SesService } from '../services/ses.service'
import {
  createEmailOrgs,
  createSend,
  createSender,
  EmailFixtureOrgs,
  emails,
} from './emailSendFixtures'

const service = useTestService()

let orgs: EmailFixtureOrgs

const winHeaders = () => ({ 'x-organization-slug': orgs.winSlug })
const serveHeaders = () => ({ 'x-organization-slug': orgs.officeSlug })

beforeEach(async () => {
  orgs = await createEmailOrgs(service.prisma, service.user.id)
})

const sendTo = async (
  organizationSlug: string,
  campaignId: number | null,
  count: number,
  status: OutreachStatus = OutreachStatus.in_progress,
) => {
  const sender = await createSender(service.prisma, organizationSlug)
  return createSend(service.prisma, {
    organizationSlug,
    campaignId,
    senderId: sender.id,
    emails: emails(count),
    status,
    recipientCap: count,
    prepared: status !== OutreachStatus.pending,
  })
}

const recipientIds = async (outreachEmailId: number) =>
  (
    await service.prisma.outreachEmailRecipient.findMany({
      where: { outreachEmailId },
      orderBy: { id: 'asc' },
      select: { id: true },
    })
  ).map((row) => row.id)

// Eight recipients: one still queued, then sent, delivered, delivered and
// opened, delivered then opened and clicked, delivered then marked as spam,
// bounced, and a bounce that never recorded a delivery.
const recordEvents = async (outreachEmailId: number) => {
  const [queued, , delivered, opened, clicked, complained, bounced] =
    await recipientIds(outreachEmailId)
  const at = subMinutes(new Date(), 20)
  const recipient = (id: number | undefined) => ({ where: { id } })
  await service.prisma.outreachEmailRecipient.updateMany({
    where: { outreachEmailId, id: { not: queued } },
    data: { status: OutreachEmailRecipientStatus.sent, sentAt: at },
  })
  await service.prisma.outreachEmailRecipient.update({
    ...recipient(delivered),
    data: { status: OutreachEmailRecipientStatus.delivered, deliveredAt: at },
  })
  await service.prisma.outreachEmailRecipient.update({
    ...recipient(opened),
    data: {
      status: OutreachEmailRecipientStatus.delivered,
      deliveredAt: at,
      firstOpenedAt: at,
    },
  })
  await service.prisma.outreachEmailRecipient.update({
    ...recipient(clicked),
    data: {
      status: OutreachEmailRecipientStatus.delivered,
      deliveredAt: at,
      firstOpenedAt: at,
      firstClickedAt: at,
    },
  })
  await service.prisma.outreachEmailRecipient.update({
    ...recipient(complained),
    data: {
      status: OutreachEmailRecipientStatus.complained,
      deliveredAt: at,
      complainedAt: at,
    },
  })
  await service.prisma.outreachEmailRecipient.update({
    ...recipient(bounced),
    data: { status: OutreachEmailRecipientStatus.bounced, bouncedAt: at },
  })
}

const EXPECTED = {
  sent: 7,
  delivered: 4,
  bounced: 1,
  complained: 1,
  opened: 2,
  clicked: 1,
}

describe('GET /v1/outreach/email/:id delivery counts', () => {
  it('counts each stage once the send has started', async () => {
    const send = await sendTo(orgs.winSlug, orgs.campaignId, 8)
    await recordEvents(send.outreachEmailId)
    // The last recipient bounced with only its status recorded.
    const ids = await recipientIds(send.outreachEmailId)
    await service.prisma.outreachEmailRecipient.update({
      where: { id: ids[7] },
      data: { status: OutreachEmailRecipientStatus.bounced },
    })

    const result = await service.client.get(
      `/v1/outreach/email/${send.outreachId}`,
      { headers: winHeaders() },
    )

    expect(result.status).toBe(200)
    expect(result.data.deliveryCounts).toEqual({ ...EXPECTED, bounced: 2 })
  })

  it('counts a Serve send the same way', async () => {
    const send = await sendTo(
      orgs.officeSlug,
      null,
      8,
      OutreachStatus.completed,
    )
    await recordEvents(send.outreachEmailId)

    const result = await service.client.get(
      `/v1/outreach/serve/email/${send.outreachId}`,
      { headers: serveHeaders() },
    )

    expect(result.status).toBe(200)
    expect(result.data.deliveryCounts).toEqual(EXPECTED)
  })

  it('has no counts before the send starts', async () => {
    const send = await sendTo(
      orgs.winSlug,
      orgs.campaignId,
      2,
      OutreachStatus.pending,
    )

    const result = await service.client.get(
      `/v1/outreach/email/${send.outreachId}`,
      { headers: winHeaders() },
    )

    expect(result.status).toBe(200)
    expect(result.data.deliveryCounts).toBeNull()
  })

  it('shows zeros for a started send nothing has gone out for yet', async () => {
    const send = await sendTo(orgs.winSlug, orgs.campaignId, 2)

    const result = await service.client.get(
      `/v1/outreach/email/${send.outreachId}`,
      { headers: winHeaders() },
    )

    expect(result.data.deliveryCounts).toEqual({
      sent: 0,
      delivered: 0,
      bounced: 0,
      complained: 0,
      opened: 0,
      clicked: 0,
    })
  })
})

describe('GET /v1/admin/outreach/email/paused delivery counts', () => {
  beforeEach(async () => {
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { roles: [UserRole.admin] },
    })
    vi.spyOn(service.app.get(SesService), 'getSendMetrics').mockResolvedValue({
      send: 0,
      bounce: 0,
      complaint: 0,
      renderingFailure: 0,
    })
  })

  const pause = (outreachEmailId: number) =>
    service.prisma.outreachEmail.update({
      where: { id: outreachEmailId },
      data: {
        pausedAt: new Date(),
        pauseReason: OutreachEmailPauseReason.bounce_rate,
      },
    })

  it('counts each paused send on its own row', async () => {
    const busy = await sendTo(orgs.winSlug, orgs.campaignId, 8)
    await recordEvents(busy.outreachEmailId)
    await pause(busy.outreachEmailId)
    const quiet = await sendTo(orgs.officeSlug, null, 3)
    await pause(quiet.outreachEmailId)

    const result = await service.client.get('/v1/admin/outreach/email/paused')

    expect(result.status).toBe(200)
    const byId = new Map<number, unknown>(
      result.data.items.map(
        (item: { outreachId: number; deliveryCounts: unknown }) => [
          item.outreachId,
          item.deliveryCounts,
        ],
      ),
    )
    expect(byId.get(busy.outreachId)).toEqual(EXPECTED)
    expect(byId.get(quiet.outreachId)).toEqual({
      sent: 0,
      delivered: 0,
      bounced: 0,
      complained: 0,
      opened: 0,
      clicked: 0,
    })
  })
})
