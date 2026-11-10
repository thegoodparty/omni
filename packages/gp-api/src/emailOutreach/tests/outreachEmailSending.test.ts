import { ConflictException } from '@nestjs/common'
import { EMAIL_CONTENT_EXAMPLES } from '@goodparty_org/contracts'
import {
  GetMetricDataCommand,
  GetMetricDataCommandOutput,
  CloudWatchClient,
} from '@aws-sdk/client-cloudwatch'
import {
  SendBulkEmailCommand,
  SendBulkEmailCommandOutput,
  SESv2Client,
  SESv2ServiceException,
  TooManyRequestsException,
} from '@aws-sdk/client-sesv2'
import { CredentialsProviderError } from '@smithy/core/config'
import type Stripe from 'stripe'
import {
  addDays,
  addHours,
  addMinutes,
  startOfMinute,
  subHours,
  subMinutes,
} from 'date-fns'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  MockInstance,
  vi,
} from 'vitest'
import { AnalyticsService } from '@/analytics/analytics.service'
import { PaymentHoldsService } from '@/paymentHolds/services/paymentHolds.service'
import { QueueProducerService } from '@/queue/producer/queueProducer.service'
import { QueueType } from '@/queue/queue.types'
import { appEnvOverrides } from '@/shared/test-utils/appEnvOverrides'
import { useTestService } from '@/test-service'
import { EVENTS } from '@/vendors/segment/segment.types'
import { StripeService } from '@/vendors/stripe/services/stripe.service'
import {
  OutreachEmailPauseReason,
  OutreachEmailRecipientStatus,
  OutreachHoldState,
  OutreachStatus,
  OutreachType,
} from '../../generated/prisma'
import { OutreachEmailAdminService } from '../services/outreachEmailAdmin.service'
import { OutreachEmailLifecycleService } from '../services/outreachEmailLifecycle.service'
import { OutreachEmailPrepareService } from '../services/outreachEmailPrepare.service'
import { OutreachEmailSendSweepService } from '../services/outreachEmailSendSweep.service'
import { OutreachEmailSettlementAdapter } from '../services/outreachEmailSettlementAdapter.service'
import {
  SesBulkInput,
  SesBulkOutcome,
  SesSendMetrics,
  SesService,
  sendTagValue,
} from '../services/ses.service'
import { emailChargeCents } from '../util/emailPricing.util'
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

const service = useTestService({ jobs: true })

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

  it('pauses a send SES rejects outright, and keeps sending the others', async () => {
    const broken = await runningSend(10)
    const other = await runningSend(10, {
      organizationSlug: orgs.officeSlug,
      campaignId: null,
    })
    sendBulk.mockImplementation(async (input) =>
      input.outreachEmailId === broken.outreachEmailId
        ? { kind: 'rejected', message: 'BadRequestException: bad data' }
        : succeedAll(input),
    )
    await sweep.runTick()
    expect((await emailRow(broken.outreachEmailId)).pauseReason).toBe(
      OutreachEmailPauseReason.manual,
    )
    expect((await emailRow(other.outreachEmailId)).sentCount).toBe(10)
  })

  it('never runs two ticks at once in one process', async () => {
    sendBulk.mockImplementation(async (input) => {
      await new Promise((resolve) => setTimeout(resolve, 100))
      return succeedAll(input)
    })
    await runningSend(50)
    await Promise.all([sweep.runTick(), sweep.runTick()])
    expect(sendBulk).toHaveBeenCalledTimes(1)
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

  it('drops recipients who unsubscribed after the send was prepared', async () => {
    const { outreachEmailId } = await runningSend(3)
    await service.prisma.outreachEmailSuppression.create({
      data: {
        email: 'person1@example.com',
        organizationSlug: orgs.winSlug,
        reason: 'link',
      },
    })
    await sweep.runTick()

    const sent = sendBulk.mock.calls.flatMap(([input]) =>
      input.entries.map((e) => e.Destination?.ToAddresses?.[0]),
    )
    expect(sent.sort()).toEqual(['person0@example.com', 'person2@example.com'])
    const { rows } = await recipientStatuses(service.prisma, outreachEmailId)
    expect(rows.map((r) => r.email)).not.toContain('person1@example.com')
  })

  it("drops the campaign's later unsubscribes from an office send", async () => {
    const { outreachEmailId } = await runningSend(2, {
      organizationSlug: orgs.officeSlug,
      campaignId: null,
    })
    await service.prisma.outreachEmailSuppression.create({
      data: {
        email: 'person0@example.com',
        organizationSlug: orgs.winSlug,
        reason: 'link',
      },
    })
    await sweep.runTick()
    const { rows } = await recipientStatuses(service.prisma, outreachEmailId)
    expect(rows.map((r) => [r.email, r.status])).toEqual([
      ['person1@example.com', OutreachEmailRecipientStatus.sent],
    ])
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

  it('fails a batch SES may have accepted, so nobody gets it twice', async () => {
    sendBulk.mockResolvedValueOnce({
      kind: 'error',
      err: new Error('Connection timed out after 30000 ms'),
    })
    const { outreachEmailId } = await runningSend(60)
    await sweep.runTick()
    expect(sendBulk).toHaveBeenCalledTimes(1)
    expect(
      (await recipientStatuses(service.prisma, outreachEmailId)).counts,
    ).toEqual({ failed: 50, queued: 10 })

    await sweep.runTick()
    const resent = sendBulk.mock.calls
      .slice(1)
      .flatMap(([input]) => input.entries)
    expect(resent).toHaveLength(10)
    expect(
      (await recipientStatuses(service.prisma, outreachEmailId)).counts,
    ).toEqual({ failed: 50, sent: 10 })
    expect((await emailRow(outreachEmailId)).sentCount).toBe(10)
  })

  it('puts back a batch that never reached SES and sends it next tick', async () => {
    sendBulk.mockResolvedValueOnce({
      kind: 'unreached',
      err: new Error('getaddrinfo ENOTFOUND email.us-west-2.amazonaws.com'),
    })
    const { outreachEmailId } = await runningSend(20)
    await sweep.runTick()
    expect(
      (await recipientStatuses(service.prisma, outreachEmailId)).counts,
    ).toEqual({ queued: 20 })
    await sweep.runTick()
    expect(
      (await recipientStatuses(service.prisma, outreachEmailId)).counts,
    ).toEqual({ sent: 20 })
  })

  const transientFor =
    (address: string) =>
    async (input: SesBulkInput): Promise<SesBulkOutcome> => {
      const result = await succeedAll(input)
      if (result.kind !== 'sent') return result
      input.entries.forEach((entry, i) => {
        if (entry.Destination?.ToAddresses?.[0] === address) {
          result.results[i] = {
            status: 'TRANSIENT_FAILURE',
            messageId: undefined,
            error: 'try again',
          }
        }
      })
      return result
    }

  it('retries a transient failure after the rest, then fails it at the cap', async () => {
    sendBulk.mockImplementation(transientFor('person0@example.com'))
    const { outreachEmailId } = await runningSend(120)
    await sweep.runTick()
    expect(
      (await recipientStatuses(service.prisma, outreachEmailId)).counts,
    ).toEqual({ sent: 119, queued: 1 })

    await sweep.runTick()
    await sweep.runTick()
    const person0 =
      await service.prisma.outreachEmailRecipient.findFirstOrThrow({
        where: { outreachEmailId, email: 'person0@example.com' },
      })
    expect(person0).toMatchObject({
      status: OutreachEmailRecipientStatus.failed,
      retryCount: 3,
    })
    await sweep.runTick()
    expect(sendBulk).toHaveBeenCalledTimes(5)
    expect((await emailRow(outreachEmailId)).sentCount).toBe(119)
  })

  it('keeps other sends going while one retries', async () => {
    const retrying = await runningSend(1)
    const other = await runningSend(120, {
      organizationSlug: orgs.officeSlug,
      campaignId: null,
    })
    sendBulk.mockImplementation(async (input) =>
      input.outreachEmailId === retrying.outreachEmailId
        ? transientFor('person0@example.com')(input)
        : succeedAll(input),
    )
    await sweep.runTick()
    expect(
      (await recipientStatuses(service.prisma, retrying.outreachEmailId))
        .counts,
    ).toEqual({ queued: 1 })
    expect((await emailRow(other.outreachEmailId)).sentCount).toBe(120)
  })

  it('pauses every send when the configuration set is paused, and alerts', async () => {
    const error = vi.spyOn(sweep.logger, 'error')
    sendBulk.mockImplementationOnce(async (input) => ({
      kind: 'sent',
      results: input.entries.map(() => ({
        status: 'CONFIGURATION_SET_SENDING_PAUSED',
        messageId: undefined,
        error: 'paused',
      })),
    }))
    const first = await runningSend(10)
    const second = await runningSend(10, {
      organizationSlug: orgs.officeSlug,
      campaignId: null,
    })
    await sweep.runTick()
    expect(sendBulk).toHaveBeenCalledTimes(1)
    for (const { outreachEmailId } of [first, second]) {
      expect((await emailRow(outreachEmailId)).pauseReason).toBe(
        OutreachEmailPauseReason.ses_account,
      )
    }
    const { rows } = await recipientStatuses(
      service.prisma,
      first.outreachEmailId,
    )
    expect(rows.every((r) => r.status === 'queued')).toBe(true)
    expect(
      await service.prisma.outreachEmailRecipient.count({
        where: { retryCount: { gt: 0 } },
      }),
    ).toBe(0)
    expect(error).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('CRITICAL'),
    )
  })
})

describe('SendBulkEmail failures', () => {
  beforeEach(() => {
    vi.mocked(ses.sendBulk).mockRestore()
  })

  const failWith = async (err: Error) => {
    vi.spyOn(SESv2Client.prototype, 'send').mockRejectedValue(err)
    return ses.sendBulk({
      from: 'a@example.com',
      tenantName: 'test-tenant',
      templateName: 'test-email-1',
      outreachEmailId: 1,
      entries: [],
    })
  }

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('calls a timeout, a reset or a 5xx unknown', async () => {
    const timeout = Object.assign(new Error('Connection timed out'), {
      name: 'TimeoutError',
    })
    const reset = Object.assign(new Error('socket hang up'), {
      code: 'ECONNRESET',
    })
    const server = new SESv2ServiceException({
      name: 'InternalFailure',
      $fault: 'server',
      $metadata: { httpStatusCode: 500 },
      message: 'internal',
    })
    for (const err of [timeout, reset, server]) {
      expect((await failWith(err)).kind).toBe('error')
    }
  })

  it('calls a connection that never opened unreached', async () => {
    for (const code of ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN']) {
      const err = Object.assign(new Error(code), { code })
      expect((await failWith(err)).kind).toBe('unreached')
    }
  })

  it('calls a connect timeout unreached', async () => {
    const err = Object.assign(
      new Error(
        '@smithy/node-http-handler - the request socket did not establish a connection with the server within the configured timeout of 3000 ms.',
      ),
      { name: 'TimeoutError' },
    )
    expect((await failWith(err)).kind).toBe('unreached')
  })

  it('calls a request or socket timeout unknown', async () => {
    const request = Object.assign(
      new Error(
        '@smithy/node-http-handler - [ERROR] a request has exceeded the configured 10000 ms requestTimeout.',
      ),
      { name: 'TimeoutError', code: 'ETIMEDOUT' },
    )
    const socket = Object.assign(
      new Error(
        '@smithy/node-http-handler - the request socket timed out after 10000 ms of inactivity (configured by client requestHandler).',
      ),
      { name: 'TimeoutError' },
    )
    for (const err of [request, socket]) {
      expect((await failWith(err)).kind).toBe('error')
    }
  })

  it('calls a credentials failure unreached', async () => {
    const err = new CredentialsProviderError('Could not load credentials', {
      tryNextLink: false,
    })
    expect((await failWith(err)).kind).toBe('unreached')
  })

  it('calls throttling throttled', async () => {
    const err = new TooManyRequestsException({
      $metadata: {},
      message: 'slow down',
    })
    expect((await failWith(err)).kind).toBe('throttled')
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
    const { outreachId, outreachEmailId } = await createSend(service.prisma, {
      organizationSlug: orgs.winSlug,
      campaignId: orgs.campaignId,
      senderId: sender.id,
      emails: ['b@example.com', 'a@example.com', 'new@example.com'],
      status: OutreachStatus.in_progress,
      recipientCap: 2,
    })

    await createHold(service.prisma, outreachId, OutreachHoldState.held)
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

  it('renders a block send with the sender and send date on the masthead', async () => {
    vi.spyOn(ses, 'ensureTenant').mockResolvedValue()
    const createTemplate = vi.spyOn(ses, 'createTemplate').mockResolvedValue()
    const sender = await createSender(service.prisma, orgs.officeSlug)
    const { outreachId, outreachEmailId } = await createSend(service.prisma, {
      organizationSlug: orgs.officeSlug,
      campaignId: null,
      senderId: sender.id,
      emails: emails(2),
      status: OutreachStatus.in_progress,
      recipientCap: 2,
      date: new Date(2026, 10, 3, 9, 0),
      content: EMAIL_CONTENT_EXAMPLES.long_update.serve,
    })
    await createHold(service.prisma, outreachId, OutreachHoldState.held)
    await service.app.get(OutreachEmailPrepareService).prepare(outreachEmailId)
    const rendered = createTemplate.mock.calls[0]?.[2]
    expect(rendered?.subject).toBe('Your October update from Ward 2')
    expect(rendered?.html).toContain(`${sender.displayName} · November 3, 2026`)
    expect(rendered?.html).toContain('class="em-subheading"')
    expect(rendered?.html).not.toContain('Paid for by')
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
    const { outreachId, outreachEmailId } = await createSend(service.prisma, {
      organizationSlug: orgs.officeSlug,
      campaignId: null,
      senderId: sender.id,
      emails: emails(3),
      status: OutreachStatus.in_progress,
      recipientCap: 3,
    })
    await createHold(service.prisma, outreachId, OutreachHoldState.held)
    await service.app.get(OutreachEmailPrepareService).prepare(outreachEmailId)
    const kept = await service.prisma.outreachEmailRecipient.findMany({
      where: { outreachEmailId },
    })
    expect(kept.map((r) => r.email).sort()).toEqual([
      'person0@example.com',
      'person2@example.com',
    ])
  })

  it('fails a send whose hold was released before prepare, and sends nothing', async () => {
    const ensureTenant = vi.spyOn(ses, 'ensureTenant').mockResolvedValue()
    const sender = await createSender(service.prisma, orgs.winSlug, {
      sesTenantName: null,
    })
    const { outreachId, outreachEmailId } = await createSend(service.prisma, {
      organizationSlug: orgs.winSlug,
      campaignId: orgs.campaignId,
      senderId: sender.id,
      emails: emails(2),
      status: OutreachStatus.in_progress,
      recipientCap: 2,
    })
    await createHold(service.prisma, outreachId, OutreachHoldState.released)
    await service.app.get(OutreachEmailPrepareService).prepare(outreachEmailId)
    expect(ensureTenant).not.toHaveBeenCalled()
    expect(
      (
        await service.prisma.outreach.findUniqueOrThrow({
          where: { id: outreachId },
        })
      ).status,
    ).toBe(OutreachStatus.failed)
    expect((await emailRow(outreachEmailId)).preparedAt).toBeNull()
    await sweep.runTick()
    expect(sendBulk).not.toHaveBeenCalled()
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

  it.each([
    OutreachHoldState.scheduled,
    OutreachHoldState.hold_failed,
    OutreachHoldState.released,
    OutreachHoldState.placing,
  ])(
    'fails and never sends a send whose hold is %s at send time',
    async (state) => {
      const holds = service.app.get(PaymentHoldsService)
      vi.spyOn(holds, 'getHold').mockResolvedValue({
        state,
        authorizedCents: null,
        captureBefore: null,
      })
      const release = vi.spyOn(holds, 'release').mockResolvedValue()
      const sendMessage = vi.spyOn(
        service.app.get(QueueProducerService),
        'sendMessage',
      )
      const { outreachId } = await dueSend()
      await service.app.get(OutreachEmailLifecycleService).startDueSends()
      expect(
        (
          await service.prisma.outreach.findUniqueOrThrow({
            where: { id: outreachId },
          })
        ).status,
      ).toBe(OutreachStatus.failed)
      expect(sendMessage).not.toHaveBeenCalled()
      if (state === OutreachHoldState.placing) {
        expect(release).toHaveBeenCalledWith({ outreachId })
      } else {
        expect(release).not.toHaveBeenCalled()
      }
    },
  )

  it.each([
    [OutreachHoldState.hold_failed, OutreachStatus.pending],
    [OutreachHoldState.scheduled, OutreachStatus.pending],
    [OutreachHoldState.hold_failed, OutreachStatus.pending_payment],
  ])(
    'leaves a %s hold on a %s send to the unpaid sweep, which emails Canceled once',
    async (holdState, status) => {
      const track = vi
        .spyOn(service.app.get(AnalyticsService), 'track')
        .mockImplementation(async () => undefined as never)
      const { outreachId } = await dueSend(status)
      await createHold(service.prisma, outreachId, holdState)

      await service.app.get(OutreachEmailLifecycleService).startDueSends()
      await service.jobs.runSchedule('paymentHoldUnpaidSweep')
      await service.jobs.runSchedule('paymentHoldUnpaidSweep')
      await service.app.get(OutreachEmailLifecycleService).startDueSends()

      const outreach = await service.prisma.outreach.findUniqueOrThrow({
        where: { id: outreachId },
        include: { paymentHold: true },
      })
      expect(outreach.status).toBe(OutreachStatus.failed)
      expect(outreach.paymentHold?.state).toBe(OutreachHoldState.released)
      const canceled = track.mock.calls.filter(
        ([, event]) => event === EVENTS.OutreachPayment.Canceled,
      )
      expect(canceled).toHaveLength(1)
      expect(canceled[0]?.[2]).toMatchObject({
        outreachId,
        channel: OutreachType.email,
        mode: 'win',
      })
      expect(canceled[0]?.[4]).toBe(`${outreachId}:canceled`)
    },
  )

  it('fails a send whose held hold Stripe no longer shows as capturable', async () => {
    vi.spyOn(service.app.get(PaymentHoldsService), 'getHold').mockRejectedValue(
      new ConflictException('The payment hold is no longer active'),
    )
    const { outreachId } = await dueSend()
    await service.app.get(OutreachEmailLifecycleService).startDueSends()
    expect(
      (
        await service.prisma.outreach.findUniqueOrThrow({
          where: { id: outreachId },
        })
      ).status,
    ).toBe(OutreachStatus.failed)
  })

  it('fails a send that still has not prepared hours after its send time', async () => {
    const release = vi
      .spyOn(service.app.get(PaymentHoldsService), 'release')
      .mockResolvedValue()
    const sendMessage = vi.spyOn(
      service.app.get(QueueProducerService),
      'sendMessage',
    )
    const sender = await createSender(service.prisma, orgs.winSlug)
    const { outreachId } = await createSend(service.prisma, {
      organizationSlug: orgs.winSlug,
      campaignId: orgs.campaignId,
      senderId: sender.id,
      emails: emails(2),
      status: OutreachStatus.in_progress,
      date: subHours(new Date(), 7),
      recipientCap: 2,
    })
    await service.prisma.outreach.update({
      where: { id: outreachId },
      data: { updatedAt: subMinutes(new Date(), 20) },
    })
    await service.app.get(OutreachEmailLifecycleService).retryStalledPrepares()
    expect(
      (
        await service.prisma.outreach.findUniqueOrThrow({
          where: { id: outreachId },
        })
      ).status,
    ).toBe(OutreachStatus.failed)
    expect(release).toHaveBeenCalledWith({ outreachId })
    expect(sendMessage).not.toHaveBeenCalled()
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

  const finishedSend = async (sentMinutesAgo: number, sentCount = 4) => {
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
      data: { sentCount },
    })
    await createHold(service.prisma, send.outreachId, OutreachHoldState.held)
    return send
  }

  const warmingOf = async (senderId: number) =>
    service.prisma.outreachEmailSender.findUniqueOrThrow({
      where: { id: senderId },
    })

  const finishCaptured = async (sentCount: number) => {
    vi.spyOn(ses, 'deleteTemplate').mockResolvedValue()
    getSendMetrics.mockResolvedValue(metrics({ send: sentCount }))
    const send = await finishedSend(10, sentCount)
    await service.prisma.outreachPaymentHold.update({
      where: { outreachId: send.outreachId },
      data: { state: OutreachHoldState.captured },
    })
    await service.app.get(OutreachEmailLifecycleService).settleFinishedSends()
    return send
  }

  it('keeps the warming step after a clean send under 500 emails', async () => {
    const { outreachId, sender } = await finishCaptured(499)
    expect(
      (
        await service.prisma.outreach.findUniqueOrThrow({
          where: { id: outreachId },
        })
      ).status,
    ).toBe(OutreachStatus.completed)
    expect(await warmingOf(sender.id)).toMatchObject({
      warmingStep: 0,
      warmingAdvancedAt: null,
    })
  })

  it('steps a sender up at most once a day', async () => {
    const { sender } = await finishCaptured(500)
    expect((await warmingOf(sender.id)).warmingStep).toBe(1)

    await finishCaptured(500)
    expect((await warmingOf(sender.id)).warmingStep).toBe(1)

    await service.prisma.outreachEmailSender.update({
      where: { id: sender.id },
      data: { warmingAdvancedAt: subHours(new Date(), 25) },
    })
    await finishCaptured(500)
    expect((await warmingOf(sender.id)).warmingStep).toBe(2)
  })

  it('settles a finished send, then completes it and advances warming when clean', async () => {
    vi.spyOn(ses, 'deleteTemplate').mockResolvedValue()
    getSendMetrics.mockResolvedValue(metrics({ send: 500 }))
    const settle = vi
      .spyOn(service.app.get(PaymentHoldsService), 'settle')
      .mockImplementation(async ({ outreachId }) => {
        await service.prisma.outreachPaymentHold.update({
          where: { outreachId },
          data: { state: OutreachHoldState.captured, capturedCents: 50 },
        })
      })
    const { outreachId, sender } = await finishedSend(10, 500)

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

  it('settles a send that was paused after its last batch', async () => {
    const settle = vi
      .spyOn(service.app.get(PaymentHoldsService), 'settle')
      .mockResolvedValue()
    const { outreachId, outreachEmailId } = await finishedSend(10)
    await service.prisma.outreachEmail.update({
      where: { id: outreachEmailId },
      data: {
        pausedAt: new Date(),
        pauseReason: OutreachEmailPauseReason.bounce_rate,
      },
    })
    await service.app.get(OutreachEmailLifecycleService).settleFinishedSends()
    expect(settle).toHaveBeenCalledWith({ outreachId })
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

  it('completes a send whose charge was disputed before it finished', async () => {
    vi.spyOn(ses, 'deleteTemplate').mockResolvedValue()
    const { outreachId } = await finishedSend(10)
    await service.prisma.outreachPaymentHold.update({
      where: { outreachId },
      data: { state: OutreachHoldState.disputed },
    })
    await service.app.get(OutreachEmailLifecycleService).settleFinishedSends()
    expect(
      (
        await service.prisma.outreach.findUniqueOrThrow({
          where: { id: outreachId },
        })
      ).status,
    ).toBe(OutreachStatus.completed)
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

describe('the send tag', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const metricData = (
    values: Record<string, number>,
  ): GetMetricDataCommandOutput => ({
    $metadata: {},
    MetricDataResults: Object.entries(values).map(([id, value]) => ({
      Id: id,
      Values: [value],
    })),
  })

  it('carries the environment ahead of the send id', () => {
    expect(sendTagValue(123)).toBe('test-123')
  })

  it('is what SendBulkEmail writes and what GetMetricData reads', async () => {
    vi.mocked(ses.sendBulk).mockRestore()
    vi.mocked(ses.getSendMetrics).mockRestore()
    const bulk = vi.spyOn(SESv2Client.prototype, 'send').mockImplementation(
      async (): Promise<SendBulkEmailCommandOutput> => ({
        $metadata: {},
        BulkEmailEntryResults: [],
      }),
    )
    const read = vi
      .spyOn(CloudWatchClient.prototype, 'send')
      .mockImplementation(async () => metricData({ send: 1 }))

    await ses.sendBulk({
      from: 'a@example.com',
      tenantName: 'test-tenant',
      templateName: 'test-email-42',
      outreachEmailId: 42,
      entries: [],
    })
    await ses.getSendMetrics(42, subHours(new Date(), 1), new Date())

    const bulkCommand = bulk.mock.calls[0]?.[0]
    expect(bulkCommand).toBeInstanceOf(SendBulkEmailCommand)
    expect(
      bulkCommand instanceof SendBulkEmailCommand &&
        bulkCommand.input.DefaultEmailTags,
    ).toEqual([{ Name: 'outreachEmailId', Value: 'test-42' }])
    const readCommand = read.mock.calls[0]?.[0]
    expect(readCommand).toBeInstanceOf(GetMetricDataCommand)
    const dimensions =
      readCommand instanceof GetMetricDataCommand
        ? readCommand.input.MetricDataQueries?.map(
            (q) => q.MetricStat?.Metric?.Dimensions,
          )
        : []
    expect(dimensions?.length).toBeGreaterThan(0)
    for (const d of dimensions ?? []) {
      expect(d).toEqual([{ Name: 'outreachEmailId', Value: 'test-42' }])
    }
  })

  it('auto-pauses on numbers read under the prefixed dimension only', async () => {
    vi.mocked(ses.getSendMetrics).mockRestore()
    const send = await runningSend(1)
    await service.prisma.outreachEmailRecipient.updateMany({
      where: { outreachEmailId: send.outreachEmailId },
      data: {
        status: OutreachEmailRecipientStatus.sent,
        sentAt: subMinutes(new Date(), 30),
      },
    })
    // Bad numbers exist only under the other environment's bare id.
    const tagged = new Map<string, Record<string, number>>([
      [String(send.outreachEmailId), { send: 500, bounce: 400 }],
    ])
    vi.spyOn(CloudWatchClient.prototype, 'send').mockImplementation(
      async (command) => {
        const value =
          command instanceof GetMetricDataCommand
            ? command.input.MetricDataQueries?.[0]?.MetricStat?.Metric
                ?.Dimensions?.[0]?.Value
            : undefined
        return metricData(tagged.get(value ?? '') ?? {})
      },
    )

    await sweep.checkAutoPause({ id: send.outreachEmailId, ...send })
    expect((await emailRow(send.outreachEmailId)).pausedAt).toBeNull()

    tagged.set(sendTagValue(send.outreachEmailId), { send: 500, bounce: 21 })
    sweep.clearCaches()
    await sweep.checkAutoPause({ id: send.outreachEmailId, ...send })
    expect((await emailRow(send.outreachEmailId)).pauseReason).toBe(
      OutreachEmailPauseReason.bounce_rate,
    )
  })
})

describe('the hold capture deadline', () => {
  let capture: MockInstance<StripeService['capturePaymentIntent']>
  let cancelHold: MockInstance<StripeService['cancelHold']>

  afterEach(() => {
    vi.restoreAllMocks()
  })

  beforeEach(() => {
    // Earlier cases stub settle on the shared service; these run the real one.
    const holds = service.app.get(PaymentHoldsService)
    if (vi.isMockFunction(holds.settle)) vi.mocked(holds.settle).mockRestore()
    const stripe = service.app.get(StripeService)
    capture = vi.spyOn(stripe, 'capturePaymentIntent').mockImplementation(
      async (id: string, amount: number) =>
        ({
          id,
          object: 'payment_intent',
          status: 'succeeded',
          amount_received: amount,
        }) as Stripe.Response<Stripe.PaymentIntent>,
    )
    cancelHold = vi.spyOn(stripe, 'cancelHold').mockResolvedValue(undefined)
    vi.spyOn(service.app.get(AnalyticsService), 'track').mockImplementation(
      async () => undefined as never,
    )
    vi.spyOn(ses, 'deleteTemplate').mockResolvedValue()
  })

  // A long send: some went out half an hour ago, the rest is still queued
  // when its hold nears captureBefore.
  const longSend = async (total: number, sent: number) => {
    const send = await runningSend(total)
    const rows = await service.prisma.outreachEmailRecipient.findMany({
      where: { outreachEmailId: send.outreachEmailId },
      orderBy: { id: 'asc' },
      take: sent,
    })
    await service.prisma.outreachEmailRecipient.updateMany({
      where: { id: { in: rows.map((r) => r.id) } },
      data: {
        status: OutreachEmailRecipientStatus.sent,
        sentAt: subMinutes(new Date(), 30),
      },
    })
    await service.prisma.outreachEmail.update({
      where: { id: send.outreachEmailId },
      data: { sentCount: sent },
    })
    const hold = await createHold(
      service.prisma,
      send.outreachId,
      OutreachHoldState.held,
    )
    await service.prisma.outreachPaymentHold.update({
      where: { id: hold.id },
      data: { captureBefore: addHours(new Date(), 6) },
    })
    return { ...send, paymentIntentId: hold.paymentIntentId }
  }

  const outreachStatus = async (outreachId: number) =>
    (
      await service.prisma.outreach.findUniqueOrThrow({
        where: { id: outreachId },
      })
    ).status

  it('charges what went out, stops the send and finishes it as sent', async () => {
    const send = await longSend(800, 600)

    await service.jobs.runSchedule('paymentHoldExpiryGuard')

    expect(capture).toHaveBeenCalledWith(
      send.paymentIntentId,
      emailChargeCents(600),
      `outreach-capture-${send.paymentIntentId}`,
    )
    expect(
      (
        await service.prisma.outreachPaymentHold.findUniqueOrThrow({
          where: { outreachId: send.outreachId },
        })
      ).capturedCents,
    ).toBe(emailChargeCents(600))
    expect(
      (await recipientStatuses(service.prisma, send.outreachEmailId)).counts,
    ).toEqual({ sent: 600, failed: 200 })

    await service.app.get(OutreachEmailLifecycleService).settleFinishedSends()

    expect(await outreachStatus(send.outreachId)).toBe(OutreachStatus.completed)
    expect((await emailRow(send.outreachEmailId)).sentCount).toBe(600)
  })

  it('claims no further batches once stopped', async () => {
    const send = await longSend(800, 600)

    await service.jobs.runSchedule('paymentHoldExpiryGuard')

    expect(await sweep.claimBatch(send.outreachEmailId)).toEqual([])
    await sweep.runTick()
    expect(sendBulk).not.toHaveBeenCalled()
  })

  it('still finishes as sent when a batch in flight at the deadline comes back', async () => {
    const send = await longSend(800, 600)
    const claimed = await sweep.claimBatch(send.outreachEmailId)

    await service.jobs.runSchedule('paymentHoldExpiryGuard')
    expect(capture).not.toHaveBeenCalled()

    // The runner died mid-batch, so the tick takes the claim back.
    await service.prisma.outreachEmailRecipient.updateMany({
      where: { id: { in: claimed } },
      data: { claimedAt: subHours(new Date(), 1) },
    })
    await sweep.runTick()
    expect(sendBulk).not.toHaveBeenCalled()
    await service.jobs.runSchedule('paymentHoldExpiryGuard')

    expect(capture).toHaveBeenCalledWith(
      send.paymentIntentId,
      emailChargeCents(600),
      `outreach-capture-${send.paymentIntentId}`,
    )
    expect(
      (await recipientStatuses(service.prisma, send.outreachEmailId)).counts,
    ).toEqual({ sent: 600, failed: 200 })
    await service.app.get(OutreachEmailLifecycleService).settleFinishedSends()
    expect(await outreachStatus(send.outreachId)).toBe(OutreachStatus.completed)
  })

  it('ends canceled when a batch in flight at the deadline sent nothing', async () => {
    const send = await longSend(5, 0)
    const claimed = await sweep.claimBatch(send.outreachEmailId)

    await service.jobs.runSchedule('paymentHoldExpiryGuard')
    await service.prisma.outreachEmailRecipient.updateMany({
      where: { id: { in: claimed } },
      data: { status: OutreachEmailRecipientStatus.failed },
    })
    await service.jobs.runSchedule('paymentHoldExpiryGuard')

    expect(capture).not.toHaveBeenCalled()
    expect(cancelHold).toHaveBeenCalledWith(send.paymentIntentId)
    await service.app.get(OutreachEmailLifecycleService).settleFinishedSends()
    expect(await outreachStatus(send.outreachId)).toBe(OutreachStatus.canceled)
  })

  it('charges nothing and ends canceled when nothing went out', async () => {
    const send = await longSend(5, 0)

    await service.jobs.runSchedule('paymentHoldExpiryGuard')

    expect(capture).not.toHaveBeenCalled()
    expect(cancelHold).toHaveBeenCalledWith(send.paymentIntentId)
    const hold = await service.prisma.outreachPaymentHold.findUniqueOrThrow({
      where: { outreachId: send.outreachId },
    })
    expect(hold.state).toBe(OutreachHoldState.released)
    expect(hold.capturedCents).toBe(0)

    await service.app.get(OutreachEmailLifecycleService).settleFinishedSends()

    expect(await outreachStatus(send.outreachId)).toBe(OutreachStatus.canceled)
  })

  it('still ends a staff cancel as canceled', async () => {
    const send = await longSend(800, 600)

    await service.app.get(OutreachEmailAdminService).cancel(send.outreachId)

    expect(await sweep.claimBatch(send.outreachEmailId)).toEqual([])

    expect(capture).toHaveBeenCalledWith(
      send.paymentIntentId,
      emailChargeCents(600),
      `outreach-capture-${send.paymentIntentId}`,
    )
    expect(
      (await recipientStatuses(service.prisma, send.outreachEmailId)).counts,
    ).toEqual({ sent: 600, queued: 200 })
    await service.app.get(OutreachEmailLifecycleService).settleFinishedSends()
    expect(await outreachStatus(send.outreachId)).toBe(OutreachStatus.canceled)
  })
})
