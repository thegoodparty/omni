import { beforeEach, describe, expect, it, vi } from 'vitest'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { useTestService } from '@/test-service'
import { OutreachEmailRecipientStatus } from '../../generated/prisma'
import { EMAIL_OUTREACH_DOMAIN } from '../emailOutreach.const'
import { EmailSnsWebhookService } from '../services/emailSnsWebhook.service'
import { SesService } from '../services/ses.service'
import {
  EmailFixtureOrgs,
  createEmailOrgs,
  createSend,
  createSender,
} from './emailSendFixtures'
import { makeSnsSigner } from './snsFixtures'

const service = useTestService({ jobs: true })

const getFileBytes = vi.fn()
const forwardReply = vi.fn()

let orgs: EmailFixtureOrgs
let senderId: number
let localPart: string
let outreachEmailId: number

const signer = makeSnsSigner()

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

// The way a reply arrives: SES stores it in the inbound bucket under its
// message id and notifies the topic, whose signed notification reaches the
// webhook. The webhook sends the emailInbound job, which runs here.
const deliver = async (
  raw: Buffer,
  key = `ses-${Math.random()}`,
  fromAuthenticated = true,
) => {
  getFileBytes.mockResolvedValue(raw)
  const notification = signer.sign({
    Message: JSON.stringify({
      notificationType: 'Received',
      mail: { messageId: key },
      receipt: {
        dmarcVerdict: { status: fromAuthenticated ? 'PASS' : 'FAIL' },
        action: {
          type: 'S3',
          bucketName: 'goodparty-email-inbound-test',
          objectKey: key,
        },
      },
    }),
  })
  const res = await service.client.post(
    '/v1/email/webhooks/sns',
    JSON.stringify(notification),
    { headers: { 'Content-Type': 'text/plain; charset=UTF-8' } },
  )
  expect(res.status).toBe(200)
  await service.jobs.settle()
  return { key }
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
  vi.spyOn(
    service.app.get(EmailSnsWebhookService),
    'fetchCertificate',
  ).mockResolvedValue(signer.certificatePem)

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
    const { key } = await deliver(message([]))
    expect(forwardReply).not.toHaveBeenCalled()
    expect(await replyRow(key)).toMatchObject({
      fromEmail: 'pat@example.com',
      classification: 'forwarded',
      forwardedAt: null,
    })
  })

  it('forwards the 10th reply from one address', async () => {
    await seedForwarded(Array(9).fill('pat@example.com'), 120)
    await deliver(message([]))
    expect(forwardReply).toHaveBeenCalledTimes(1)
  })

  it('counts different repliers separately', async () => {
    await seedForwarded(Array(10).fill('pat@example.com'), 120)
    const { key } = await deliver(message([], 'Hello', 'lee@example.com'))
    expect(forwardReply).toHaveBeenCalledTimes(1)
    expect((await replyRow(key))?.forwardedAt).not.toBeNull()
  })

  it('does not count replies older than a day', async () => {
    await seedForwarded(Array(10).fill('pat@example.com'), 25 * 60)
    await deliver(message([]))
    expect(forwardReply).toHaveBeenCalledTimes(1)
  })

  it('saves but does not forward the 201st reply to a sender in an hour', async () => {
    await seedForwarded(
      Array.from({ length: 200 }, (_, i) => `person${i}@example.com`),
    )
    const { key } = await deliver(message([]))
    expect(forwardReply).not.toHaveBeenCalled()
    expect((await replyRow(key))?.forwardedAt).toBeNull()
  })

  it('forwards the 200th reply to a sender in an hour', async () => {
    await seedForwarded(
      Array.from({ length: 199 }, (_, i) => `person${i}@example.com`),
    )
    await deliver(message([]))
    expect(forwardReply).toHaveBeenCalledTimes(1)
  })
})

describe('a real reply', () => {
  it('is saved, matched to the send and forwarded as "<name> via GoodParty"', async () => {
    const { key } = await deliver(message([]))

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

  it('is matched to the send once SES has reported the email delivered', async () => {
    await service.prisma.outreachEmailRecipient.updateMany({
      where: { outreachEmailId },
      data: { status: OutreachEmailRecipientStatus.delivered },
    })
    const { key } = await deliver(message([]))

    expect(await replyRow(key)).toMatchObject({ outreachEmailId })
  })

  it('is not forwarded twice when SNS delivers it again', async () => {
    const raw = message([])
    const { key } = await deliver(raw)
    await deliver(raw, key)
    expect(forwardReply).toHaveBeenCalledTimes(1)
  })

  it('retries a forward that failed', async () => {
    forwardReply.mockRejectedValueOnce(new Error('SES down'))
    const { key } = await deliver(message([]))
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
    await deliver(raw)
    const { fromName } = forwardReply.mock.calls[0]?.[0] ?? {}
    expect(fromName).not.toMatch(/[<>"\\]/)
    expect(fromName).toMatch(/ via GoodParty$/)
  })
})

describe('replies that are not forwarded', () => {
  it('drops an out-of-office reply', async () => {
    const { key } = await deliver(
      message(['Auto-Submitted: auto-replied'], 'I am away'),
    )
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
    const { key } = await deliver(raw)
    expect(forwardReply).not.toHaveBeenCalled()
    expect((await replyRow(key))?.classification).toBe('bounce')
  })

  it.each([
    [
      'an SES mailbox simulator out-of-office reply',
      ['Auto-Submitted: auto-replied', 'X-Autoreply: yes'],
      'ooto@simulator.amazonses.com',
    ],
    [
      'an auto-reply from a system address',
      ['Auto-Submitted: auto-replied'],
      'postmaster@example.com',
    ],
    [
      'a Gmail vacation responder',
      ['Auto-Submitted: auto-replied', 'Precedence: bulk'],
      'pat@gmail.com',
    ],
    [
      'an Outlook automatic reply',
      ['X-Auto-Response-Suppress: All', 'Precedence: auto_reply'],
      'pat@outlook.com',
    ],
    ['an X-Autorespond reply', ['X-Autorespond: yes'], 'pat@example.com'],
  ])('classifies %s as an auto-reply', async (_name, headers, from) => {
    const { key } = await deliver(message(headers, 'I am away', from))
    expect(forwardReply).not.toHaveBeenCalled()
    expect((await replyRow(key))?.classification).toBe('auto_reply')
  })

  it('classifies an Exchange DSN with Auto-Submitted as a bounce', async () => {
    const raw = Buffer.from(
      [
        `To: ${localPart}@${EMAIL_OUTREACH_DOMAIN}`,
        'From: postmaster@example.com',
        'Subject: Undeliverable: Town hall',
        'Auto-Submitted: auto-generated',
        'Content-Type: multipart/report; report-type=delivery-status; boundary="B"',
        '',
        '--B',
        'Content-Type: text/plain',
        '',
        'Delivery has failed.',
        '--B--',
      ].join('\r\n'),
    )
    const { key } = await deliver(raw)
    expect(forwardReply).not.toHaveBeenCalled()
    expect((await replyRow(key))?.classification).toBe('bounce')
  })

  it('classifies an Exim bounce carrying Auto-Submitted as a bounce', async () => {
    const { key } = await deliver(
      message(
        [
          'Auto-Submitted: auto-replied',
          'X-Failed-Recipients: gone@example.com',
        ],
        'Gone',
        'Mailer-Daemon@example.com',
      ),
    )
    expect((await replyRow(key))?.classification).toBe('bounce')
  })

  it('classifies a bare MAILER-DAEMON notice as a bounce', async () => {
    const { key } = await deliver(
      message(
        ['X-Failed-Recipients: gone@example.com'],
        'Gone',
        'MAILER-DAEMON@example.com',
      ),
    )
    expect((await replyRow(key))?.classification).toBe('bounce')
  })

  it('drops a message SES marked as spam', async () => {
    const { key } = await deliver(message(['X-SES-Spam-Verdict: FAIL']))
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
    const { key } = await deliver(raw)
    expect(forwardReply).not.toHaveBeenCalled()
    expect((await replyRow(key))?.classification).toBe('auto_reply')
  })

  it('never forwards a message carrying our forward marker', async () => {
    const { key } = await deliver(message(['X-GoodParty-Forwarded: 1']))
    expect(forwardReply).not.toHaveBeenCalled()
    expect((await replyRow(key))?.classification).toBe('auto_reply')
  })
})

describe('stop and unsubscribe replies', () => {
  it.each([
    ['STOP', 'STOP\r\n\r\nOn Tue, Jane wrote:\r\n> Join us'],
    ['unsubscribe', 'Please unsubscribe me.'],
  ])('turns "%s" into an unsubscribe', async (_, body) => {
    const { key } = await deliver(message([], body))
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
    const { key } = await deliver(message([], 'stop'), undefined, false)
    expect(await suppression()).toBeNull()
    expect((await replyRow(key))?.classification).toBe('forwarded')
  })

  it('ignores verdict headers the sender wrote into the message', async () => {
    await deliver(
      message(['X-SES-SPF-Verdict: PASS', 'X-SES-DKIM-Verdict: PASS'], 'stop'),
      undefined,
      false,
    )
    expect(await suppression()).toBeNull()
  })

  it.each(['Stop by my office Tuesday', 'Remove the yard sign please'])(
    'forwards "%s" instead of unsubscribing',
    async (body) => {
      const { key } = await deliver(message([], body))
      expect((await replyRow(key))?.classification).toBe('forwarded')
      expect(await suppression()).toBeNull()
    },
  )

  it('does not unsubscribe again when a delivered stop is redelivered after an undo', async () => {
    const { key } = await deliver(message([], 'stop'))
    await service.prisma.outreachEmailSuppression.updateMany({
      data: { revokedAt: new Date() },
    })
    await deliver(message([], 'stop'), key)
    expect((await suppression())?.revokedAt).toBeInstanceOf(Date)
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
    await deliver(raw)
    expect(await suppression()).not.toBeNull()
  })

  const mailto = (subject: string, extraHeaders: string[], body: string) =>
    Buffer.from(
      [
        `To: ${localPart}@${EMAIL_OUTREACH_DOMAIN}`,
        'From: pat@example.com',
        `Subject: ${subject}`,
        ...extraHeaders,
        '',
        body,
      ].join('\r\n'),
    )

  it.each([
    ['unsubscribe', [], 'Sent from my iPhone'],
    ['  Re: UNSUBSCRIBE ', [], 'This message was sent by Gmail.'],
    ['Unsubscribe', ['Auto-Submitted: auto-generated'], 'Unsubscribe request'],
  ])(
    'unsubscribes on the mailto subject "%s" whatever the body',
    async (subject, headers, body) => {
      const { key } = await deliver(mailto(subject, headers, body))
      expect(forwardReply).not.toHaveBeenCalled()
      expect((await replyRow(key))?.classification).toBe('unsubscribe')
      expect(await suppression()).not.toBeNull()
    },
  )

  it('forwards a mailto unsubscribe SES could not authenticate', async () => {
    const { key } = await deliver(
      mailto('unsubscribe', [], 'Sent from my iPhone'),
      undefined,
      false,
    )
    expect(await suppression()).toBeNull()
    expect((await replyRow(key))?.classification).toBe('forwarded')
  })

  it('forwards a subject that only mentions unsubscribing', async () => {
    const { key } = await deliver(
      mailto('How do I unsubscribe my mom?', [], 'She keeps getting these.'),
    )
    expect(await suppression()).toBeNull()
    expect((await replyRow(key))?.classification).toBe('forwarded')
  })

  it('counts a repeated unsubscribe once', async () => {
    await deliver(message([], 'stop'))
    await deliver(message([], 'stop'))
    const send = await service.prisma.outreachEmail.findUniqueOrThrow({
      where: { id: outreachEmailId },
    })
    expect(send.unsubscribedCount).toBe(1)
  })

  it('forwards a reply that only mentions stopping later in a longer message', async () => {
    const body = `Great event. ${'I will see you there. '.repeat(20)}Please stop by my booth.`
    await deliver(message([], body))
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
    const { key } = await deliver(raw)
    expect(await replyRow(key)).toBeNull()
    expect(forwardReply).not.toHaveBeenCalled()
  })

  it('retries a message that is not in S3 yet', async () => {
    getFileBytes.mockResolvedValueOnce(undefined)
    const { key } = await deliver(message([]))
    expect(getFileBytes).toHaveBeenCalledTimes(2)
    expect((await replyRow(key))?.forwardedAt).not.toBeNull()
  })
})
