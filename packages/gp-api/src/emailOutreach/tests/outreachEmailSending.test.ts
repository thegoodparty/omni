import { addDays, addMinutes, startOfMinute, subMinutes } from 'date-fns'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PaymentHoldsService } from '@/paymentHolds/services/paymentHolds.service'
import { QueueProducerService } from '@/queue/producer/queueProducer.service'
import { QueueType } from '@/queue/queue.types'
import { appEnvOverrides } from '@/shared/test-utils/appEnvOverrides'
import { useTestService } from '@/test-service'
import {
  OutreachEmailPauseReason,
  OutreachEmailRecipientStatus,
  OutreachHoldState,
  OutreachStatus,
} from '../../generated/prisma'
import { OutreachEmailLifecycleService } from '../services/outreachEmailLifecycle.service'
import { OutreachEmailPrepareService } from '../services/outreachEmailPrepare.service'
import { OutreachEmailSendSweepService } from '../services/outreachEmailSendSweep.service'
import { OutreachEmailSettlementAdapter } from '../services/outreachEmailSettlementAdapter.service'
import {
  SesBulkInput,
  SesBulkOutcome,
  SesSendMetrics,
  SesService,
} from '../services/ses.service'
import { verifyUnsubscribeToken } from '../util/unsubscribeToken.util'
import {
  createEmailOrgs,
  createHold,
  createSend,
  createSender,
  EmailFixtureOrgs,
  emails,
  recipientStatuses,
} from './emailSendFixtures'

const service = useTestService()

const SIGNING_KEY = 'test-unsubscribe-signing-key'

let orgs: EmailFixtureOrgs
let ses: SesService
let sweep: OutreachEmailSendSweepService
const sendBulk = vi.fn<(input: SesBulkInput) => Promise<SesBulkOutcome>>()
const getSendMetrics = vi.fn<() => Promise<SesSendMetrics>>()

const succeedAll = async (input: SesBulkInput): Promise<SesBulkOutcome> => ({
  kind: 'sent',
  results: input.entries.map((_, i) => ({
    status: 'SUCCESS',
    messageId: `msg-${input.outreachEmailId}-${Date.now()}-${i}-${Math.random()}`,
    error: undefined,
  })),
})

const metrics = (overrides: Partial<SesSendMetrics>): SesSendMetrics => ({
  send: 0,
  bounce: 0,
  complaint: 0,
  renderingFailure: 0,
  ...overrides,
})

beforeEach(async () => {
  await service.prisma
    .$executeRaw`INSERT INTO email_sweep_lease (id) VALUES (1)`
  orgs = await createEmailOrgs(service.prisma, service.user.id)
  ses = service.app.get(SesService)
  sweep = service.app.get(OutreachEmailSendSweepService)
  sweep.clearCaches()
  vi.spyOn(sweep, 'sleep').mockResolvedValue(undefined)
  sendBulk.mockReset().mockImplementation(succeedAll)
  getSendMetrics.mockReset().mockResolvedValue(metrics({}))
  vi.spyOn(ses, 'sendBulk').mockImplementation(sendBulk)
  vi.spyOn(ses, 'getSendMetrics').mockImplementation(getSendMetrics)
  vi.spyOn(ses, 'getAccount').mockResolvedValue({
    sendingEnabled: true,
    max24HourSend: 50_000,
    maxSendRate: 14,
    sentLast24Hours: 0,
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

const runningSend = async (
  count: number,
  {
    domain = 'example.com',
    organizationSlug = orgs.winSlug,
    campaignId = orgs.campaignId as number | null,
  } = {},
) => {
  const sender = await createSender(service.prisma, organizationSlug)
  const send = await createSend(service.prisma, {
    organizationSlug,
    campaignId,
    senderId: sender.id,
    emails: emails(count, domain),
    status: OutreachStatus.in_progress,
    recipientCap: count,
    prepared: true,
  })
  return { sender, ...send }
}

const emailRow = (outreachEmailId: number) =>
  service.prisma.outreachEmail.findUniqueOrThrow({
    where: { id: outreachEmailId },
  })

describe('recipient claim', () => {
  it('never hands the same row to two concurrent claimers', async () => {
    const { outreachEmailId } = await runningSend(600)
    const seen = new Set<number>()
    for (let round = 0; round < 8; round++) {
      const [a, b] = await Promise.all([
        sweep.claimBatch(outreachEmailId),
        sweep.claimBatch(outreachEmailId),
      ])
      for (const id of [...a, ...b]) {
        expect(seen.has(id)).toBe(false)
        seen.add(id)
      }
    }
    expect(seen.size).toBe(600)
    expect(await sweep.claimBatch(outreachEmailId)).toEqual([])
  })

  it('claims nothing once the send is stopping', async () => {
    const { outreachEmailId } = await runningSend(5)
    await service.prisma.outreachEmail.update({
      where: { id: outreachEmailId },
      data: { stoppingAt: new Date() },
    })
    expect(await sweep.claimBatch(outreachEmailId)).toEqual([])
  })
})

describe('sweep lease', () => {
  it('lets one holder run while another holds a live lease', async () => {
    await service.prisma.emailSweepLease.update({
      where: { id: 1 },
      data: { holder: 'other-task', expiresAt: addMinutes(new Date(), 1) },
    })
    expect(await sweep.takeLease()).toBe(false)
    await runningSend(3)
    await sweep.runTick()
    expect(sendBulk).not.toHaveBeenCalled()
  })

  it('takes over an expired lease', async () => {
    await service.prisma.emailSweepLease.update({
      where: { id: 1 },
      data: { holder: 'dead-task', expiresAt: subMinutes(new Date(), 1) },
    })
    expect(await sweep.takeLease()).toBe(true)
  })
})

describe('send sweep', () => {
  it('sends every batch through the tenant with the tag and unsubscribe headers', async () => {
    const { outreachEmailId, sender } = await runningSend(120)
    await sweep.runTick()

    expect(sendBulk).toHaveBeenCalledTimes(3)
    for (const [input] of sendBulk.mock.calls) {
      expect(input.tenantName).toBe(sender.sesTenantName)
      expect(input.outreachEmailId).toBe(outreachEmailId)
      expect(input.templateName).toBe('local-email-test')
      expect(input.entries.length).toBeLessThanOrEqual(50)
    }
    const entry = sendBulk.mock.calls
      .flatMap(([input]) => input.entries)
      .find((e) => e.Destination?.ToAddresses?.[0] === 'person0@example.com')
    if (!entry) throw new Error('person0 was never sent')
    const headers = Object.fromEntries(
      (entry.ReplacementHeaders ?? []).map((h) => [h.Name, h.Value]),
    )
    expect(headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')
    const token = /t=([^>]+)>/.exec(headers['List-Unsubscribe'] ?? '')?.[1]
    expect(verifyUnsubscribeToken(SIGNING_KEY, token ?? '')).toMatchObject({
      email: 'person0@example.com',
      organizationSlug: orgs.winSlug,
      outreachEmailId,
    })
    const data = JSON.parse(
      entry.ReplacementEmailContent?.ReplacementTemplate
        ?.ReplacementTemplateData ?? '{}',
    )
    expect(data.first_name).toBe('Person0')
    expect(data.unsubscribe_url).toContain(`/email/unsubscribe/${token}`)

    const { counts } = await recipientStatuses(service.prisma, outreachEmailId)
    expect(counts).toEqual({ sent: 120 })
    expect((await emailRow(outreachEmailId)).sentCount).toBe(120)
  })

  it('puts a throttled batch back and ends the tick', async () => {
    sendBulk.mockResolvedValueOnce({ kind: 'throttled' })
    const { outreachEmailId } = await runningSend(80)
    await sweep.runTick()
    expect(sendBulk).toHaveBeenCalledTimes(1)
    const { counts } = await recipientStatuses(service.prisma, outreachEmailId)
    expect(counts).toEqual({ queued: 80 })
    expect((await emailRow(outreachEmailId)).pausedAt).toBeNull()
  })

  it('pauses running sends on a quota error, and resumes them when the quota frees up', async () => {
    sendBulk.mockResolvedValueOnce({ kind: 'quota' })
    const { outreachEmailId } = await runningSend(10)
    await sweep.runTick()
    expect(await emailRow(outreachEmailId)).toMatchObject({
      pauseReason: OutreachEmailPauseReason.daily_quota,
    })
    expect(
      (await recipientStatuses(service.prisma, outreachEmailId)).counts,
    ).toEqual({ queued: 10 })

    sweep.clearCaches()
    await sweep.runTick()
    expect(await emailRow(outreachEmailId)).toMatchObject({
      pausedAt: null,
      pauseReason: null,
      sentCount: 10,
    })
  })

  it('pauses near the daily quota without sending', async () => {
    vi.spyOn(ses, 'getAccount').mockResolvedValue({
      sendingEnabled: true,
      max24HourSend: 50_000,
      maxSendRate: 14,
      sentLast24Hours: 46_000,
    })
    const { outreachEmailId } = await runningSend(10)
    await sweep.runTick()
    expect(sendBulk).not.toHaveBeenCalled()
    expect((await emailRow(outreachEmailId)).pauseReason).toBe(
      OutreachEmailPauseReason.daily_quota,
    )
  })

  it('pauses only the send whose tenant SES paused', async () => {
    const paused = await runningSend(10)
    const other = await runningSend(10, {
      organizationSlug: orgs.officeSlug,
      campaignId: null,
    })
    sendBulk.mockImplementation(async (input) =>
      input.outreachEmailId === paused.outreachEmailId
        ? { kind: 'tenant_paused', message: 'Sending disabled for <arn>' }
        : succeedAll(input),
    )
    await sweep.runTick()
    expect((await emailRow(paused.outreachEmailId)).pauseReason).toBe(
      OutreachEmailPauseReason.ses_tenant,
    )
    expect(
      (await recipientStatuses(service.prisma, paused.outreachEmailId)).counts,
    ).toEqual({ queued: 10 })
    expect((await emailRow(other.outreachEmailId)).sentCount).toBe(10)
  })

  it('fails only the recipient SES refused', async () => {
    sendBulk.mockImplementationOnce(async (input) => {
      const result = await succeedAll(input)
      if (result.kind === 'sent') {
        result.results[1] = {
          status: 'MESSAGE_REJECTED',
          messageId: undefined,
          error: 'Email address is not verified',
        }
      }
      return result
    })
    const { outreachEmailId } = await runningSend(3)
    await sweep.runTick()
    const { counts } = await recipientStatuses(service.prisma, outreachEmailId)
    expect(counts).toEqual({ sent: 2, failed: 1 })
    expect((await emailRow(outreachEmailId)).sentCount).toBe(2)
  })

  it('stops a tick at its time budget', async () => {
    sendBulk.mockImplementation(async (input) => {
      await new Promise((resolve) => setTimeout(resolve, 400))
      return succeedAll(input)
    })
    const { outreachEmailId } = await runningSend(150)
    await sweep.runTick(250)
    expect(sendBulk).toHaveBeenCalledTimes(1)
    expect(
      (await recipientStatuses(service.prisma, outreachEmailId)).counts,
    ).toEqual({ sent: 50, queued: 100 })
  })

  it('in dev, sends only to team and simulator addresses', async () => {
    appEnvOverrides.VENDOR_MODE = 'live'
    const sender = await createSender(service.prisma, orgs.winSlug)
    const { outreachEmailId } = await createSend(service.prisma, {
      organizationSlug: orgs.winSlug,
      campaignId: orgs.campaignId,
      senderId: sender.id,
      emails: [
        'success@simulator.amazonses.com',
        'neighbor@example.com',
        'staff@goodparty.org',
      ],
      status: OutreachStatus.in_progress,
      recipientCap: 3,
      prepared: true,
    })
    await sweep.runTick()
    const sentTo = sendBulk.mock.calls.flatMap(([input]) =>
      input.entries.flatMap((e) => e.Destination?.ToAddresses ?? []),
    )
    expect(sentTo.sort()).toEqual([
      'staff@goodparty.org',
      'success@simulator.amazonses.com',
    ])
    const { rows } = await recipientStatuses(service.prisma, outreachEmailId)
    expect(rows.find((r) => r.email === 'neighbor@example.com')?.status).toBe(
      OutreachEmailRecipientStatus.failed,
    )
  })

  it('sends nothing without the unsubscribe signing key', async () => {
    vi.stubEnv('EMAIL_UNSUBSCRIBE_SIGNING_KEY', '')
    await runningSend(3)
    await sweep.runTick()
    expect(sendBulk).not.toHaveBeenCalled()
  })

  it('returns a stuck sending row to queued and sends it', async () => {
    const { outreachEmailId } = await runningSend(2)
    await service.prisma.outreachEmailRecipient.updateMany({
      where: { outreachEmailId },
      data: {
        status: OutreachEmailRecipientStatus.sending,
        claimedAt: subMinutes(new Date(), 6),
      },
    })
    await sweep.runTick()
    expect(
      (await recipientStatuses(service.prisma, outreachEmailId)).counts,
    ).toEqual({ sent: 2 })
  })
})

describe('auto-pause from SES numbers', () => {
  const sentSend = async () => {
    const send = await runningSend(1)
    await service.prisma.outreachEmailRecipient.updateMany({
      where: { outreachEmailId: send.outreachEmailId },
      data: {
        status: OutreachEmailRecipientStatus.sent,
        sentAt: subMinutes(new Date(), 30),
      },
    })
    return send
  }

  it('does not pause under 500 sends, however bad', async () => {
    getSendMetrics.mockResolvedValue(metrics({ send: 499, bounce: 200 }))
    const send = await sentSend()
    await sweep.checkAutoPause({ id: send.outreachEmailId, ...send })
    expect((await emailRow(send.outreachEmailId)).pausedAt).toBeNull()
  })

  it('pauses past 4% bounces', async () => {
    getSendMetrics.mockResolvedValue(metrics({ send: 500, bounce: 21 }))
    const send = await sentSend()
    await sweep.checkAutoPause({ id: send.outreachEmailId, ...send })
    expect((await emailRow(send.outreachEmailId)).pauseReason).toBe(
      OutreachEmailPauseReason.bounce_rate,
    )
  })

  it('does not pause at exactly 4% bounces', async () => {
    getSendMetrics.mockResolvedValue(metrics({ send: 500, bounce: 20 }))
    const send = await sentSend()
    await sweep.checkAutoPause({ id: send.outreachEmailId, ...send })
    expect((await emailRow(send.outreachEmailId)).pausedAt).toBeNull()
  })

  it('pauses past 0.08% complaints', async () => {
    getSendMetrics.mockResolvedValue(metrics({ send: 1_000, complaint: 1 }))
    const send = await sentSend()
    await sweep.checkAutoPause({ id: send.outreachEmailId, ...send })
    expect((await emailRow(send.outreachEmailId)).pauseReason).toBe(
      OutreachEmailPauseReason.complaint_rate,
    )
  })

  it('pauses on any rendering failure', async () => {
    getSendMetrics.mockResolvedValue(metrics({ send: 10, renderingFailure: 1 }))
    const send = await sentSend()
    await sweep.checkAutoPause({ id: send.outreachEmailId, ...send })
    expect((await emailRow(send.outreachEmailId)).pauseReason).toBe(
      OutreachEmailPauseReason.manual,
    )
  })

  it('reads from the last resume, so a resumed send is not paused again at once', async () => {
    const send = await sentSend()
    const resumedAt = subMinutes(new Date(), 2)
    await service.prisma.outreachEmail.update({
      where: { id: send.outreachEmailId },
      data: { resumedAt },
    })
    getSendMetrics.mockImplementation(async () => metrics({ send: 40 }))
    await sweep.checkAutoPause({ id: send.outreachEmailId, ...send })
    expect(getSendMetrics).toHaveBeenCalledWith(
      send.outreachEmailId,
      startOfMinute(resumedAt),
      expect.any(Date),
    )
    expect((await emailRow(send.outreachEmailId)).pausedAt).toBeNull()
  })

  it('keeps sending when CloudWatch cannot be read', async () => {
    getSendMetrics.mockRejectedValue(new Error('CloudWatch down'))
    const send = await sentSend()
    await sweep.checkAutoPause({ id: send.outreachEmailId, ...send })
    expect((await emailRow(send.outreachEmailId)).pausedAt).toBeNull()
  })
})

describe('prepare', () => {
  it('creates the tenant once and keeps the least recently emailed up to the cap', async () => {
    const ensureTenant = vi.spyOn(ses, 'ensureTenant').mockResolvedValue()
    const createTemplate = vi.spyOn(ses, 'createTemplate').mockResolvedValue()
    const sender = await createSender(service.prisma, orgs.winSlug, {
      sesTenantName: null,
    })
    const earlier = await createSend(service.prisma, {
      organizationSlug: orgs.winSlug,
      campaignId: orgs.campaignId,
      senderId: sender.id,
      emails: ['a@example.com', 'b@example.com'],
      status: OutreachStatus.completed,
    })
    await service.prisma.outreachEmailRecipient.updateMany({
      where: {
        outreachEmailId: earlier.outreachEmailId,
        email: 'a@example.com',
      },
      data: { status: 'sent', sentAt: subMinutes(new Date(), 60) },
    })
    await service.prisma.outreachEmailRecipient.updateMany({
      where: {
        outreachEmailId: earlier.outreachEmailId,
        email: 'b@example.com',
      },
      data: { status: 'sent', sentAt: subMinutes(new Date(), 10) },
    })
    const { outreachEmailId } = await createSend(service.prisma, {
      organizationSlug: orgs.winSlug,
      campaignId: orgs.campaignId,
      senderId: sender.id,
      emails: ['b@example.com', 'a@example.com', 'new@example.com'],
      status: OutreachStatus.in_progress,
      recipientCap: 2,
    })

    const prepares = service.app.get(OutreachEmailPrepareService)
    await prepares.prepare(outreachEmailId)
    await prepares.prepare(outreachEmailId)

    expect(ensureTenant).toHaveBeenCalledTimes(1)
    expect(ensureTenant).toHaveBeenCalledWith(`test-${orgs.winSlug}`)
    expect(createTemplate).toHaveBeenCalledTimes(1)
    const kept = await service.prisma.outreachEmailRecipient.findMany({
      where: { outreachEmailId },
      orderBy: { id: 'asc' },
    })
    expect(kept.map((r) => r.email)).toEqual([
      'a@example.com',
      'new@example.com',
    ])
    expect(await emailRow(outreachEmailId)).toMatchObject({
      sesTemplateName: `test-email-${outreachEmailId}`,
    })
    expect(
      (
        await service.prisma.outreachEmailSender.findUniqueOrThrow({
          where: { id: sender.id },
        })
      ).sesTenantName,
    ).toBe(`test-${orgs.winSlug}`)
  })

  it("skips the campaign's unsubscribes on an office send", async () => {
    vi.spyOn(ses, 'ensureTenant').mockResolvedValue()
    vi.spyOn(ses, 'createTemplate').mockResolvedValue()
    await service.prisma.outreachEmailSuppression.create({
      data: {
        email: 'person1@example.com',
        organizationSlug: orgs.winSlug,
        reason: 'link',
      },
    })
    const sender = await createSender(service.prisma, orgs.officeSlug)
    const { outreachEmailId } = await createSend(service.prisma, {
      organizationSlug: orgs.officeSlug,
      campaignId: null,
      senderId: sender.id,
      emails: emails(3),
      status: OutreachStatus.in_progress,
      recipientCap: 3,
    })
    await service.app.get(OutreachEmailPrepareService).prepare(outreachEmailId)
    const kept = await service.prisma.outreachEmailRecipient.findMany({
      where: { outreachEmailId },
    })
    expect(kept.map((r) => r.email).sort()).toEqual([
      'person0@example.com',
      'person2@example.com',
    ])
  })
})

describe('starting due sends', () => {
  const dueSend = async (status: OutreachStatus = OutreachStatus.pending) => {
    const sender = await createSender(service.prisma, orgs.winSlug)
    return createSend(service.prisma, {
      organizationSlug: orgs.winSlug,
      campaignId: orgs.campaignId,
      senderId: sender.id,
      emails: emails(2),
      status,
      date: subMinutes(new Date(), 1),
      recipientCap: 2,
    })
  }

  it('starts a held send and enqueues its prepare', async () => {
    const sendMessage = vi
      .spyOn(service.app.get(QueueProducerService), 'sendMessage')
      .mockResolvedValue(undefined)
    vi.spyOn(service.app.get(PaymentHoldsService), 'getHold').mockResolvedValue(
      {
        state: OutreachHoldState.held,
        authorizedCents: 50,
        captureBefore: addDays(new Date(), 4),
      },
    )
    const { outreachId, outreachEmailId } = await dueSend()
    await service.app.get(OutreachEmailLifecycleService).startDueSends()
    expect(
      (
        await service.prisma.outreach.findUniqueOrThrow({
          where: { id: outreachId },
        })
      ).status,
    ).toBe(OutreachStatus.in_progress)
    expect(sendMessage).toHaveBeenCalledWith(
      {
        type: QueueType.EMAIL_SEND_PREPARE,
        data: { outreachEmailId },
      },
      `emailSendPrepare-${outreachEmailId}`,
      {
        throwOnError: true,
        deduplicationId: `emailSendPrepare-${outreachEmailId}`,
      },
    )
  })

  it('puts the send back when the enqueue fails', async () => {
    vi.spyOn(
      service.app.get(QueueProducerService),
      'sendMessage',
    ).mockRejectedValue(new Error('SQS down'))
    vi.spyOn(service.app.get(PaymentHoldsService), 'getHold').mockResolvedValue(
      {
        state: OutreachHoldState.held,
        authorizedCents: 50,
        captureBefore: addDays(new Date(), 4),
      },
    )
    const { outreachId } = await dueSend()
    await service.app.get(OutreachEmailLifecycleService).startDueSends()
    expect(
      (
        await service.prisma.outreach.findUniqueOrThrow({
          where: { id: outreachId },
        })
      ).status,
    ).toBe(OutreachStatus.pending)
  })

  it('fails a send whose hold failed, and releases it', async () => {
    const holds = service.app.get(PaymentHoldsService)
    vi.spyOn(holds, 'getHold').mockResolvedValue({
      state: OutreachHoldState.hold_failed,
      authorizedCents: null,
      captureBefore: null,
    })
    const release = vi.spyOn(holds, 'release').mockResolvedValue()
    const { outreachId } = await dueSend(OutreachStatus.pending_payment)
    await service.app.get(OutreachEmailLifecycleService).startDueSends()
    expect(
      (
        await service.prisma.outreach.findUniqueOrThrow({
          where: { id: outreachId },
        })
      ).status,
    ).toBe(OutreachStatus.failed)
    expect(release).toHaveBeenCalledWith({ outreachId })
  })

  it('waits on a hold still scheduled', async () => {
    vi.spyOn(service.app.get(PaymentHoldsService), 'getHold').mockResolvedValue(
      {
        state: OutreachHoldState.scheduled,
        authorizedCents: null,
        captureBefore: null,
      },
    )
    const { outreachId } = await dueSend()
    await service.app.get(OutreachEmailLifecycleService).startDueSends()
    expect(
      (
        await service.prisma.outreach.findUniqueOrThrow({
          where: { id: outreachId },
        })
      ).status,
    ).toBe(OutreachStatus.pending)
  })
})

describe('settling and finishing', () => {
  it('reports not ready while a batch is in flight, then the charge', async () => {
    const { outreachId, outreachEmailId } = await runningSend(3)
    const adapter = service.app.get(OutreachEmailSettlementAdapter)
    await service.prisma.outreachEmailRecipient.updateMany({
      where: { outreachEmailId },
      data: {
        status: OutreachEmailRecipientStatus.sending,
        claimedAt: new Date(),
      },
    })
    expect(await adapter.stopAndReport(outreachId)).toEqual({ ready: false })
    expect((await emailRow(outreachEmailId)).stoppingAt).not.toBeNull()

    await service.prisma.outreachEmailRecipient.updateMany({
      where: { outreachEmailId },
      data: { status: OutreachEmailRecipientStatus.sent },
    })
    await service.prisma.outreachEmail.update({
      where: { id: outreachEmailId },
      data: { sentCount: 3 },
    })
    expect(await adapter.stopAndReport(outreachId)).toEqual({
      ready: true,
      amountCents: 50,
    })
    expect(await adapter.stopAndReport(outreachId)).toEqual({
      ready: true,
      amountCents: 50,
    })
  })

  it('reports nothing owed when nothing sent', async () => {
    const { outreachId } = await runningSend(3)
    expect(
      await service.app
        .get(OutreachEmailSettlementAdapter)
        .stopAndReport(outreachId),
    ).toEqual({ ready: true, amountCents: 0 })
  })

  const finishedSend = async (sentMinutesAgo: number) => {
    const send = await runningSend(4)
    await service.prisma.outreachEmailRecipient.updateMany({
      where: { outreachEmailId: send.outreachEmailId },
      data: {
        status: OutreachEmailRecipientStatus.sent,
        sentAt: subMinutes(new Date(), sentMinutesAgo),
      },
    })
    await service.prisma.outreachEmail.update({
      where: { id: send.outreachEmailId },
      data: { sentCount: 4 },
    })
    await createHold(service.prisma, send.outreachId, OutreachHoldState.held)
    return send
  }

  it('settles a finished send, then completes it and advances warming when clean', async () => {
    vi.spyOn(ses, 'deleteTemplate').mockResolvedValue()
    getSendMetrics.mockResolvedValue(metrics({ send: 4 }))
    const settle = vi
      .spyOn(service.app.get(PaymentHoldsService), 'settle')
      .mockImplementation(async ({ outreachId }) => {
        await service.prisma.outreachPaymentHold.update({
          where: { outreachId },
          data: { state: OutreachHoldState.captured, capturedCents: 50 },
        })
      })
    const { outreachId, sender } = await finishedSend(10)

    await service.app.get(OutreachEmailLifecycleService).settleFinishedSends()

    expect(settle).toHaveBeenCalledWith({ outreachId })
    expect(
      (
        await service.prisma.outreach.findUniqueOrThrow({
          where: { id: outreachId },
        })
      ).status,
    ).toBe(OutreachStatus.completed)
    expect(
      (
        await service.prisma.outreachEmailSender.findUniqueOrThrow({
          where: { id: sender.id },
        })
      ).warmingStep,
    ).toBe(1)
  })

  it('keeps the warming step after a send with too many bounces', async () => {
    vi.spyOn(ses, 'deleteTemplate').mockResolvedValue()
    getSendMetrics.mockResolvedValue(metrics({ send: 100, bounce: 2 }))
    const { outreachId, sender } = await finishedSend(10)
    await service.prisma.outreachPaymentHold.update({
      where: { outreachId },
      data: { state: OutreachHoldState.captured },
    })
    await service.app.get(OutreachEmailLifecycleService).settleFinishedSends()
    expect(
      (
        await service.prisma.outreachEmailSender.findUniqueOrThrow({
          where: { id: sender.id },
        })
      ).warmingStep,
    ).toBe(0)
  })

  it('waits for SES numbers before finishing a send that just ended', async () => {
    const { outreachId } = await finishedSend(1)
    await service.prisma.outreachPaymentHold.update({
      where: { outreachId },
      data: { state: OutreachHoldState.captured },
    })
    await service.app.get(OutreachEmailLifecycleService).settleFinishedSends()
    expect(
      (
        await service.prisma.outreach.findUniqueOrThrow({
          where: { id: outreachId },
        })
      ).status,
    ).toBe(OutreachStatus.in_progress)
  })

  it('finishes a stopped send with recipients left as canceled', async () => {
    vi.spyOn(ses, 'deleteTemplate').mockResolvedValue()
    const { outreachId, outreachEmailId } = await runningSend(3)
    await service.prisma.outreachEmail.update({
      where: { id: outreachEmailId },
      data: { stoppingAt: new Date() },
    })
    await createHold(service.prisma, outreachId, OutreachHoldState.released)
    await service.app.get(OutreachEmailLifecycleService).settleFinishedSends()
    expect(
      (
        await service.prisma.outreach.findUniqueOrThrow({
          where: { id: outreachId },
        })
      ).status,
    ).toBe(OutreachStatus.canceled)
  })
})
