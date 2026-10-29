import { beforeEach, describe, expect, it, vi } from 'vitest'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { useTestService } from '@/test-service'
import { OutreachEmailRecipientStatus } from '../../generated/prisma'
import { EMAIL_OUTREACH_DOMAIN } from '../emailOutreach.const'
import { EmailOutreachQueueService } from '../services/emailOutreachQueue.service'
import { SesService } from '../services/ses.service'
import {
  EmailFixtureOrgs,
  createEmailOrgs,
  createSend,
  createSender,
} from './emailSendFixtures'

const service = useTestService()

const getFileBytes = vi.fn()
const forwardReply = vi.fn()

let orgs: EmailFixtureOrgs
let senderId: number
let localPart: string
let outreachEmailId: number

const BUCKET = 'goodparty-email-inbound-test'

const message = (
  headers: string[],
  body = 'Thanks for the update!',
  fromAddress = 'pat@example.com',
) =>
  Buffer.from(
    [
      `To: Jane Doe <${localPart}@${EMAIL_OUTREACH_DOMAIN}>`,
      `From: Pat Voter <${fromAddress}>`,
      'Subject: Re: Town hall on Thursday',
      ...headers,
      '',
      body,
    ].join('\r\n'),
  )

const deliver = (
  raw: Buffer | undefined,
  key = `inbound/${Math.random()}`,
  fromAuthenticated = true,
) => {
  getFileBytes.mockResolvedValue(raw)
  return {
    key,
    result: service.app.get(EmailOutreachQueueService).handleInbound({
      snsMessageId: 'sns-1',
      bucket: BUCKET,
      key,
      fromAuthenticated,
    }),
  }
}

const replyRow = (key: string) =>
  service.prisma.outreachEmailReply.findUnique({
    where: { rawObjectKey: key },
  })

const suppression = () =>
  service.prisma.outreachEmailSuppression.findFirst({
    where: { email: 'pat@example.com', organizationSlug: orgs.winSlug },
  })

beforeEach(async () => {
  getFileBytes.mockReset()
  forwardReply.mockReset().mockResolvedValue('ses-msg-1')
  vi.spyOn(service.app.get(S3Service), 'getFileBytes').mockImplementation(
    getFileBytes,
  )
  vi.spyOn(service.app.get(SesService), 'forwardReply').mockImplementation(
    forwardReply,
  )

  orgs = await createEmailOrgs(service.prisma, service.user.id)
  const sender = await createSender(service.prisma, orgs.winSlug)
  senderId = sender.id
  localPart = sender.localPart
  const send = await createSend(service.prisma, {
    organizationSlug: orgs.winSlug,
    campaignId: orgs.campaignId,
    senderId,
    emails: ['pat@example.com'],
  })
  outreachEmailId = send.outreachEmailId
  await service.prisma.outreachEmailRecipient.updateMany({
    where: { outreachEmailId },
    data: { status: OutreachEmailRecipientStatus.sent, sentAt: new Date() },
  })
})

const seedForwarded = (fromEmails: string[], minutesAgo = 5) =>
  service.prisma.outreachEmailReply.createMany({
    data: fromEmails.map((fromEmail, i) => ({
      senderId,
      fromEmail,
      rawObjectKey: `seed/${Math.random()}-${i}`,
      classification: 'forwarded' as const,
      forwardedAt: new Date(Date.now() - minutesAgo * 60 * 1000),
    })),
  })

describe('forwarding caps', () => {
  it('saves but does not forward the 11th reply from one address in a day', async () => {
    await seedForwarded(Array(10).fill('pat@example.com'), 120)
    const { key, result } = deliver(message([]))
    expect(await result).toBe(true)
    expect(forwardReply).not.toHaveBeenCalled()
    expect(await replyRow(key)).toMatchObject({
      fromEmail: 'pat@example.com',
      classification: 'forwarded',
      forwardedAt: null,
    })
  })

  it('forwards the 10th reply from one address', async () => {
    await seedForwarded(Array(9).fill('pat@example.com'), 120)
    const { result } = deliver(message([]))
    expect(await result).toBe(true)
    expect(forwardReply).toHaveBeenCalledTimes(1)
  })

  it('counts different repliers separately', async () => {
    await seedForwarded(Array(10).fill('pat@example.com'), 120)
    const { key, result } = deliver(message([], 'Hello', 'lee@example.com'))
    expect(await result).toBe(true)
    expect(forwardReply).toHaveBeenCalledTimes(1)
    expect((await replyRow(key))?.forwardedAt).not.toBeNull()
  })

  it('does not count replies older than a day', async () => {
    await seedForwarded(Array(10).fill('pat@example.com'), 25 * 60)
    const { result } = deliver(message([]))
    expect(await result).toBe(true)
    expect(forwardReply).toHaveBeenCalledTimes(1)
  })

  it('saves but does not forward the 201st reply to a sender in an hour', async () => {
    await seedForwarded(
      Array.from({ length: 200 }, (_, i) => `person${i}@example.com`),
    )
    const { key, result } = deliver(message([]))
    expect(await result).toBe(true)
    expect(forwardReply).not.toHaveBeenCalled()
    expect((await replyRow(key))?.forwardedAt).toBeNull()
  })

  it('forwards the 200th reply to a sender in an hour', async () => {
    await seedForwarded(
      Array.from({ length: 199 }, (_, i) => `person${i}@example.com`),
    )
    const { result } = deliver(message([]))
    expect(await result).toBe(true)
    expect(forwardReply).toHaveBeenCalledTimes(1)
  })
})

describe('a real reply', () => {
  it('is saved, matched to the send and forwarded as "<name> via GoodParty"', async () => {
    const { key, result } = deliver(message([]))
    expect(await result).toBe(true)

    expect(forwardReply).toHaveBeenCalledTimes(1)
    expect(forwardReply).toHaveBeenCalledWith(
      expect.objectContaining({
        from: `${localPart}@${EMAIL_OUTREACH_DOMAIN}`,
        fromName: 'Pat Voter via GoodParty',
        replyTo: 'pat@example.com',
        to: 'jane@example.com',
        subject: 'Re: Town hall on Thursday',
      }),
    )
    expect(forwardReply.mock.calls[0]?.[0].text).toContain(
      'Thanks for the update!',
    )
    expect(await replyRow(key)).toMatchObject({
      senderId,
      outreachEmailId,
      fromEmail: 'pat@example.com',
      classification: 'forwarded',
      forwardedAt: expect.any(Date),
    })
  })

  it('is not forwarded twice when SNS delivers it again', async () => {
    const raw = message([])
    const { key, result } = deliver(raw)
    await result
    const again = await service.app
      .get(EmailOutreachQueueService)
      .handleInbound({
        snsMessageId: 'b',
        bucket: BUCKET,
        key,
        fromAuthenticated: true,
      })
    expect(again).toBe(true)
    expect(forwardReply).toHaveBeenCalledTimes(1)
  })

  it('retries a forward that failed, once', async () => {
    forwardReply.mockRejectedValueOnce(new Error('SES down'))
    const { key, result } = deliver(message([]))
    expect(await result).toBe(false)
    expect((await replyRow(key))?.forwardedAt).toBeNull()

    const retry = await service.app
      .get(EmailOutreachQueueService)
      .handleInbound({
        snsMessageId: 'c',
        bucket: BUCKET,
        key,
        fromAuthenticated: true,
      })
    expect(retry).toBe(true)
    expect(forwardReply).toHaveBeenCalledTimes(2)
    expect((await replyRow(key))?.forwardedAt).not.toBeNull()
  })

  it('strips a hostile display name', async () => {
    const raw = Buffer.from(
      [
        `To: ${localPart}@${EMAIL_OUTREACH_DOMAIN}`,
        'From: "Pat\\" <evil@x.com>" <pat@example.com>',
        'Subject: hi',
        '',
        'hello',
      ].join('\r\n'),
    )
    await deliver(raw).result
    const { fromName } = forwardReply.mock.calls[0]?.[0] ?? {}
    expect(fromName).not.toMatch(/[<>"\\]/)
    expect(fromName).toMatch(/ via GoodParty$/)
  })
})

describe('replies that are not forwarded', () => {
  it('drops an out-of-office reply', async () => {
    const { key, result } = deliver(
      message(['Auto-Submitted: auto-replied'], 'I am away'),
    )
    expect(await result).toBe(true)
    expect(forwardReply).not.toHaveBeenCalled()
    expect((await replyRow(key))?.classification).toBe('auto_reply')
  })

  it('drops a bounce notice in DSN format', async () => {
    const raw = Buffer.from(
      [
        `To: ${localPart}@${EMAIL_OUTREACH_DOMAIN}`,
        'From: MAILER-DAEMON@example.com',
        'Subject: Undelivered Mail Returned to Sender',
        'Content-Type: multipart/report; report-type=delivery-status; boundary="B"',
        '',
        '--B',
        'Content-Type: text/plain',
        '',
        'The address was not found.',
        '--B--',
      ].join('\r\n'),
    )
    const { key, result } = deliver(raw)
    expect(await result).toBe(true)
    expect(forwardReply).not.toHaveBeenCalled()
    expect((await replyRow(key))?.classification).toBe('bounce')
  })

  it('drops a message SES marked as spam', async () => {
    const { key } = deliver(message(['X-SES-Spam-Verdict: FAIL']))
    await service.app.get(EmailOutreachQueueService).handleInbound({
      snsMessageId: 's',
      bucket: BUCKET,
      key,
      fromAuthenticated: true,
    })
    expect(forwardReply).not.toHaveBeenCalled()
    expect((await replyRow(key))?.classification).toBe('spam')
  })

  it('never forwards a message from our own domain', async () => {
    const raw = Buffer.from(
      [
        `To: ${localPart}@${EMAIL_OUTREACH_DOMAIN}`,
        `From: someone@${EMAIL_OUTREACH_DOMAIN}`,
        'Subject: loop',
        '',
        'hello',
      ].join('\r\n'),
    )
    const { key, result } = deliver(raw)
    expect(await result).toBe(true)
    expect(forwardReply).not.toHaveBeenCalled()
    expect((await replyRow(key))?.classification).toBe('auto_reply')
  })

  it('never forwards a message carrying our forward marker', async () => {
    const { key, result } = deliver(message(['X-GoodParty-Forwarded: 1']))
    expect(await result).toBe(true)
    expect(forwardReply).not.toHaveBeenCalled()
    expect((await replyRow(key))?.classification).toBe('auto_reply')
  })
})

describe('stop and unsubscribe replies', () => {
  it.each([
    ['STOP', 'STOP\r\n\r\nOn Tue, Jane wrote:\r\n> Join us'],
    ['unsubscribe', 'Please unsubscribe me.'],
  ])('turns "%s" into an unsubscribe', async (_, body) => {
    const { key, result } = deliver(message([], body))
    expect(await result).toBe(true)
    expect(forwardReply).not.toHaveBeenCalled()
    expect((await replyRow(key))?.classification).toBe('unsubscribe')
    expect(await suppression()).toMatchObject({
      reason: 'reply',
      revokedAt: null,
    })
    const send = await service.prisma.outreachEmail.findUniqueOrThrow({
      where: { id: outreachEmailId },
    })
    expect(send.unsubscribedCount).toBe(1)
  })

  it('forwards a stop reply SES could not authenticate, without unsubscribing', async () => {
    const { key } = deliver(message([], 'stop'), undefined, false)
    await service.app.get(EmailOutreachQueueService).handleInbound({
      snsMessageId: 'f',
      bucket: BUCKET,
      key,
      fromAuthenticated: false,
    })
    expect(await suppression()).toBeNull()
    expect((await replyRow(key))?.classification).toBe('forwarded')
  })

  it('ignores verdict headers the sender wrote into the message', async () => {
    const { key } = deliver(
      message(['X-SES-SPF-Verdict: PASS', 'X-SES-DKIM-Verdict: PASS'], 'stop'),
      undefined,
      false,
    )
    await service.app.get(EmailOutreachQueueService).handleInbound({
      snsMessageId: 'g',
      bucket: BUCKET,
      key,
      fromAuthenticated: false,
    })
    expect(await suppression()).toBeNull()
  })

  it.each(['Stop by my office Tuesday', 'Remove the yard sign please'])(
    'forwards "%s" instead of unsubscribing',
    async (body) => {
      const { key } = deliver(message([], body))
      await service.app.get(EmailOutreachQueueService).handleInbound({
        snsMessageId: 'h',
        bucket: BUCKET,
        key,
        fromAuthenticated: true,
      })
      expect((await replyRow(key))?.classification).toBe('forwarded')
      expect(await suppression()).toBeNull()
    },
  )

  it('does not unsubscribe again when a delivered stop is redelivered after an undo', async () => {
    const { key } = deliver(message([], 'stop'))
    const queue = service.app.get(EmailOutreachQueueService)
    await queue.handleInbound({
      snsMessageId: '1',
      bucket: BUCKET,
      key,
      fromAuthenticated: true,
    })
    await service.prisma.outreachEmailSuppression.updateMany({
      data: { revokedAt: new Date() },
    })
    await queue.handleInbound({
      snsMessageId: '2',
      bucket: BUCKET,
      key,
      fromAuthenticated: true,
    })
    expect((await suppression())?.revokedAt).not.toBeNull()
  })

  it('reads the mailto unsubscribe link: subject only, no body', async () => {
    const raw = Buffer.from(
      [
        `To: ${localPart}@${EMAIL_OUTREACH_DOMAIN}`,
        'From: pat@example.com',
        'Subject: unsubscribe',
        '',
        '',
      ].join('\r\n'),
    )
    await deliver(raw).result
    expect(await suppression()).not.toBeNull()
  })

  it('counts a repeated unsubscribe once', async () => {
    await deliver(message([], 'stop')).result
    await deliver(message([], 'stop')).result
    const send = await service.prisma.outreachEmail.findUniqueOrThrow({
      where: { id: outreachEmailId },
    })
    expect(send.unsubscribedCount).toBe(1)
  })

  it('forwards a reply that only mentions stopping later in a longer message', async () => {
    const body = `Great event. ${'I will see you there. '.repeat(20)}Please stop by my booth.`
    await deliver(message([], body)).result
    expect(forwardReply).toHaveBeenCalledTimes(1)
    expect(await suppression()).toBeNull()
  })
})

describe('messages that cannot be handled', () => {
  it('acks a message for no sender of ours', async () => {
    const raw = Buffer.from(
      [
        `To: nobody@${EMAIL_OUTREACH_DOMAIN}`,
        'From: pat@example.com',
        'Subject: hi',
        '',
        'hello',
      ].join('\r\n'),
    )
    const { key, result } = deliver(raw)
    expect(await result).toBe(true)
    expect(await replyRow(key)).toBeNull()
    expect(forwardReply).not.toHaveBeenCalled()
  })

  it('redelivers a message that is not in S3 yet', async () => {
    expect(await deliver(undefined).result).toBe(false)
  })

  it("ignores a bucket that is not this environment's inbound bucket", async () => {
    getFileBytes.mockResolvedValue(message([]))
    const result = await service.app
      .get(EmailOutreachQueueService)
      .handleInbound({
        snsMessageId: 'x',
        bucket: 'goodparty-email-inbound-prod',
        key: 'k',
        fromAuthenticated: true,
      })
    expect(result).toBe(true)
    expect(getFileBytes).not.toHaveBeenCalled()
  })

  it('redelivers when the inbound bucket is not configured', async () => {
    vi.stubEnv('EMAIL_INBOUND_BUCKET', '')
    getFileBytes.mockResolvedValue(message([]))
    const result = await service.app
      .get(EmailOutreachQueueService)
      .handleInbound({
        snsMessageId: 'x',
        bucket: BUCKET,
        key: 'k',
        fromAuthenticated: true,
      })
    expect(result).toBe(false)
    expect(getFileBytes).not.toHaveBeenCalled()
    vi.unstubAllEnvs()
  })
})
