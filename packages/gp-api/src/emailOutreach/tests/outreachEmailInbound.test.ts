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

const BUCKET = 'email-inbound-test'

const message = (headers: string[], body = 'Thanks for the update!') =>
  Buffer.from(
    [
      `To: Jane Doe <${localPart}@${EMAIL_OUTREACH_DOMAIN}>`,
      'From: Pat Voter <pat@example.com>',
      'Subject: Re: Town hall on Thursday',
      'X-SES-SPF-Verdict: PASS',
      ...headers,
      '',
      body,
    ].join('\r\n'),
  )

const deliver = (raw: Buffer | undefined, key = `inbound/${Math.random()}`) => {
  getFileBytes.mockResolvedValue(raw)
  return {
    key,
    result: service.app
      .get(EmailOutreachQueueService)
      .handleInbound({ snsMessageId: 'sns-1', bucket: BUCKET, key }),
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
    const { key } = deliver(raw)
    await service.app
      .get(EmailOutreachQueueService)
      .handleInbound({ snsMessageId: 'a', bucket: BUCKET, key })
    const again = await service.app
      .get(EmailOutreachQueueService)
      .handleInbound({ snsMessageId: 'b', bucket: BUCKET, key })
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
      .handleInbound({ snsMessageId: 'c', bucket: BUCKET, key })
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
    await service.app
      .get(EmailOutreachQueueService)
      .handleInbound({ snsMessageId: 's', bucket: BUCKET, key })
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
    const { key } = deliver(
      Buffer.from(
        [
          `To: ${localPart}@${EMAIL_OUTREACH_DOMAIN}`,
          'From: pat@example.com',
          'X-SES-SPF-Verdict: FAIL',
          'X-SES-DKIM-Verdict: FAIL',
          'Subject: hi',
          '',
          'stop',
        ].join('\r\n'),
      ),
    )
    await service.app
      .get(EmailOutreachQueueService)
      .handleInbound({ snsMessageId: 'f', bucket: BUCKET, key })
    expect(await suppression()).toBeNull()
    expect((await replyRow(key))?.classification).toBe('forwarded')
  })

  it('does not unsubscribe again when a delivered stop is redelivered after an undo', async () => {
    const { key } = deliver(message([], 'stop'))
    const queue = service.app.get(EmailOutreachQueueService)
    await queue.handleInbound({ snsMessageId: '1', bucket: BUCKET, key })
    await service.prisma.outreachEmailSuppression.updateMany({
      data: { revokedAt: new Date() },
    })
    await queue.handleInbound({ snsMessageId: '2', bucket: BUCKET, key })
    expect((await suppression())?.revokedAt).not.toBeNull()
  })

  it('reads the mailto unsubscribe link: subject only, no body', async () => {
    const raw = Buffer.from(
      [
        `To: ${localPart}@${EMAIL_OUTREACH_DOMAIN}`,
        'From: pat@example.com',
        'X-SES-DKIM-Verdict: PASS',
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

  it('ignores a bucket that is not an inbound bucket', async () => {
    getFileBytes.mockResolvedValue(message([]))
    const result = await service.app
      .get(EmailOutreachQueueService)
      .handleInbound({
        snsMessageId: 'x',
        bucket: 'some-other-bucket',
        key: 'k',
      })
    expect(result).toBe(true)
    expect(getFileBytes).not.toHaveBeenCalled()
  })
})
