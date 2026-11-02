import { subMinutes } from 'date-fns'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PaymentHoldsService } from '@/paymentHolds/services/paymentHolds.service'
import { useTestService } from '@/test-service'
import { SlackService } from '@/vendors/slack/services/slack.service'
import { SlackChannel } from '@/vendors/slack/slackService.types'
import {
  OutreachEmailPauseReason,
  OutreachEmailRecipientStatus,
  OutreachHoldState,
  OutreachStatus,
  UserRole,
} from '../../generated/prisma'
import { OutreachEmailPauseAlertService } from '../services/outreachEmailPauseAlert.service'
import { OutreachEmailSendSweepService } from '../services/outreachEmailSendSweep.service'
import { SesSendMetrics, SesService } from '../services/ses.service'
import {
  createEmailOrgs,
  createHold,
  createSend,
  createSender,
  EmailFixtureOrgs,
  emails,
} from './emailSendFixtures'

const service = useTestService()

const BASE = '/v1/admin/outreach/email'

let orgs: EmailFixtureOrgs
let ses: SesService
const getSendMetrics = vi.fn<() => Promise<SesSendMetrics>>()

const metrics = (overrides: Partial<SesSendMetrics>): SesSendMetrics => ({
  send: 0,
  bounce: 0,
  complaint: 0,
  renderingFailure: 0,
  ...overrides,
})

beforeEach(async () => {
  vi.clearAllMocks()
  await service.prisma.user.update({
    where: { id: service.user.id },
    data: { roles: [UserRole.admin] },
  })
  orgs = await createEmailOrgs(service.prisma, service.user.id)
  ses = service.app.get(SesService)
  getSendMetrics.mockReset().mockResolvedValue(metrics({}))
  vi.spyOn(ses, 'getSendMetrics').mockImplementation(getSendMetrics)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

const pausedSend = async (
  reason: OutreachEmailPauseReason = OutreachEmailPauseReason.bounce_rate,
) => {
  const sender = await createSender(service.prisma, orgs.winSlug)
  const send = await createSend(service.prisma, {
    organizationSlug: orgs.winSlug,
    campaignId: orgs.campaignId,
    senderId: sender.id,
    emails: emails(3),
    status: OutreachStatus.in_progress,
    recipientCap: 3,
    prepared: true,
  })
  await service.prisma.outreachEmailRecipient.updateMany({
    where: { outreachEmailId: send.outreachEmailId },
    data: {
      status: OutreachEmailRecipientStatus.sent,
      sentAt: subMinutes(new Date(), 30),
    },
  })
  await service.prisma.outreachEmail.update({
    where: { id: send.outreachEmailId },
    data: { pausedAt: new Date(), pauseReason: reason, sentCount: 3 },
  })
  return send
}

const emailRow = (id: number) =>
  service.prisma.outreachEmail.findUniqueOrThrow({ where: { id } })

describe('GET /v1/admin/outreach/email/paused', () => {
  it('lists paused sends with SES rates since the last resume', async () => {
    getSendMetrics.mockResolvedValue(
      metrics({ send: 600, bounce: 30, complaint: 1 }),
    )
    const send = await pausedSend()

    const result = await service.client.get(`${BASE}/paused`)

    expect(result.status).toBe(200)
    expect(result.data.items).toHaveLength(1)
    expect(result.data.items[0]).toMatchObject({
      outreachId: send.outreachId,
      organizationSlug: orgs.winSlug,
      pauseReason: 'bounce_rate',
      sentCount: 3,
      metrics: { send: 600, bounce: 30, bounceRate: 0.05 },
    })
  })

  it('reads from the last resume', async () => {
    const send = await pausedSend()
    const resumedAt = subMinutes(new Date(), 2)
    await service.prisma.outreachEmail.update({
      where: { id: send.outreachEmailId },
      data: { resumedAt },
    })

    await service.client.get(`${BASE}/paused`)

    expect(getSendMetrics).toHaveBeenCalledWith(
      send.outreachEmailId,
      expect.any(Date),
      expect.any(Date),
    )
    const [, start] = getSendMetrics.mock.calls[0] as unknown as [number, Date]
    expect(start.getTime()).toBeGreaterThanOrEqual(resumedAt.getTime() - 60_000)
  })

  it('still lists a send when CloudWatch cannot be read', async () => {
    getSendMetrics.mockRejectedValue(new Error('CloudWatch down'))
    await pausedSend()

    const result = await service.client.get(`${BASE}/paused`)

    expect(result.status).toBe(200)
    expect(result.data.items[0].metrics).toBeNull()
  })

  it('leaves out sends that are running or stopping', async () => {
    const sender = await createSender(service.prisma, orgs.winSlug)
    await createSend(service.prisma, {
      organizationSlug: orgs.winSlug,
      campaignId: orgs.campaignId,
      senderId: sender.id,
      emails: emails(2),
      status: OutreachStatus.in_progress,
      recipientCap: 2,
      prepared: true,
    })
    const stopping = await pausedSend()
    await service.prisma.outreachEmail.update({
      where: { id: stopping.outreachEmailId },
      data: { stoppingAt: new Date() },
    })

    const result = await service.client.get(`${BASE}/paused`)

    expect(result.data.items).toHaveLength(0)
  })

  it('is closed to people who are not staff', async () => {
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { roles: [] },
    })
    const result = await service.client.get(`${BASE}/paused`)
    expect(result.status).toBe(403)
  })
})

describe('POST /v1/admin/outreach/email/:id/resume', () => {
  it('sets resumedAt and clears the pause', async () => {
    const send = await pausedSend(OutreachEmailPauseReason.complaint_rate)

    const result = await service.client.post(
      `${BASE}/${send.outreachId}/resume`,
      {},
    )

    expect(result.status).toBe(204)
    const row = await emailRow(send.outreachEmailId)
    expect(row.pausedAt).toBeNull()
    expect(row.pauseReason).toBeNull()
    expect(row.resumedAt).not.toBeNull()
  })

  it('refuses a pause SES put on the tenant', async () => {
    const send = await pausedSend(OutreachEmailPauseReason.ses_tenant)

    const result = await service.client.post(
      `${BASE}/${send.outreachId}/resume`,
      {},
    )

    expect(result.status).toBe(409)
    const row = await emailRow(send.outreachEmailId)
    expect(row.pauseReason).toBe(OutreachEmailPauseReason.ses_tenant)
    expect(row.resumedAt).toBeNull()
  })

  it('refuses a send that is not paused', async () => {
    const send = await pausedSend()
    await service.prisma.outreachEmail.update({
      where: { id: send.outreachEmailId },
      data: { pausedAt: null, pauseReason: null },
    })

    const result = await service.client.post(
      `${BASE}/${send.outreachId}/resume`,
      {},
    )

    expect(result.status).toBe(409)
  })

  it('answers 404 for an unknown send', async () => {
    const result = await service.client.post(`${BASE}/999999999/resume`, {})
    expect(result.status).toBe(404)
  })

  it('is closed to people who are not staff', async () => {
    const send = await pausedSend()
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { roles: [] },
    })
    const result = await service.client.post(
      `${BASE}/${send.outreachId}/resume`,
      {},
    )
    expect(result.status).toBe(403)
  })
})

describe('POST /v1/admin/outreach/email/:id/cancel', () => {
  it('stops the send through settle', async () => {
    const send = await pausedSend()
    await createHold(service.prisma, send.outreachId, OutreachHoldState.held)
    const settle = vi
      .spyOn(service.app.get(PaymentHoldsService), 'settle')
      .mockResolvedValue()

    const result = await service.client.post(
      `${BASE}/${send.outreachId}/cancel`,
      {},
    )

    expect(result.status).toBe(204)
    expect(settle).toHaveBeenCalledWith({ outreachId: send.outreachId })
    const row = await service.prisma.outreachEmail.findUniqueOrThrow({
      where: { outreachId: send.outreachId },
    })
    expect(row.stoppingAt).not.toBeNull()
  })

  it('refuses a send whose hold is not held', async () => {
    const send = await pausedSend()
    await createHold(
      service.prisma,
      send.outreachId,
      OutreachHoldState.released,
    )
    const settle = vi
      .spyOn(service.app.get(PaymentHoldsService), 'settle')
      .mockResolvedValue()

    const result = await service.client.post(
      `${BASE}/${send.outreachId}/cancel`,
      {},
    )

    expect(result.status).toBe(409)
    expect(settle).not.toHaveBeenCalled()
  })

  it('refuses a send that is not running', async () => {
    const send = await pausedSend()
    await service.prisma.outreach.update({
      where: { id: send.outreachId },
      data: { status: OutreachStatus.completed },
    })

    const result = await service.client.post(
      `${BASE}/${send.outreachId}/cancel`,
      {},
    )

    expect(result.status).toBe(409)
  })
})

describe('pause alerts', () => {
  const alert = () => service.app.get(OutreachEmailPauseAlertService)

  it('posts nothing, and does not fail, when no channel is set', async () => {
    vi.stubEnv('SLACK_EMAIL_OUTREACH_PAUSES_CHANNEL_ID', '')
    const message = vi
      .spyOn(service.app.get(SlackService), 'message')
      .mockResolvedValue('ok')
    const send = await pausedSend()

    await alert().notify(send.outreachEmailId, 'bounce_rate')

    expect(message).not.toHaveBeenCalled()
  })

  it('posts to the staff channel with a link to the admin page', async () => {
    vi.stubEnv('SLACK_EMAIL_OUTREACH_PAUSES_CHANNEL_ID', 'C123')
    vi.stubEnv('GP_ADMIN_BASE_URL', 'https://admin.example.com')
    const message = vi
      .spyOn(service.app.get(SlackService), 'message')
      .mockResolvedValue('ok')
    const send = await pausedSend()

    await alert().notify(send.outreachEmailId, 'ses_tenant')

    expect(message).toHaveBeenCalledTimes(1)
    const [body, channel] = message.mock.calls[0] ?? []
    expect(channel).toBe(SlackChannel.emailOutreachPauses)
    expect(body?.text).toContain(
      'https://admin.example.com/dashboard/email-sends',
    )
    expect(body?.text).toContain('Amazon SES paused this sender')
  })

  it('swallows a Slack failure', async () => {
    vi.stubEnv('SLACK_EMAIL_OUTREACH_PAUSES_CHANNEL_ID', 'C123')
    vi.spyOn(service.app.get(SlackService), 'message').mockRejectedValue(
      new Error('slack down'),
    )
    const send = await pausedSend()

    await expect(
      alert().notify(send.outreachEmailId, 'manual'),
    ).resolves.toBeUndefined()
  })

  it('fires when the sweep auto-pauses a send, once', async () => {
    const notify = vi.spyOn(alert(), 'notify').mockResolvedValue()
    const sweep = service.app.get(OutreachEmailSendSweepService)
    sweep.clearCaches()
    getSendMetrics.mockResolvedValue(metrics({ send: 500, bounce: 21 }))
    const send = await pausedSend()
    await service.prisma.outreachEmail.update({
      where: { id: send.outreachEmailId },
      data: { pausedAt: null, pauseReason: null },
    })

    await sweep.checkAutoPause({ id: send.outreachEmailId, ...send })
    sweep.clearCaches()
    await sweep.checkAutoPause({ id: send.outreachEmailId, ...send })

    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith(send.outreachEmailId, 'bounce_rate')
  })
})
