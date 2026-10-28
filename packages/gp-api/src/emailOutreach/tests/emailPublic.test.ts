import { createHash } from 'node:crypto'
import { addHours, subHours } from 'date-fns'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EmailService } from '@/email/email.service'
import { QueueProducerService } from '@/queue/producer/queueProducer.service'
import { QueueType } from '@/queue/queue.types'
import { useTestService } from '@/test-service'
import { EmailSnsWebhookService } from '../services/emailSnsWebhook.service'
import {
  signUnsubscribeToken,
  unsubscribeSigningKey,
} from '../util/unsubscribeToken.util'
import {
  EmailFixtureOrgs,
  createEmailOrgs,
  createSend,
  createSender,
} from './emailSendFixtures'
import { makeSnsSigner } from './snsFixtures'

const service = useTestService()

let orgs: EmailFixtureOrgs

beforeEach(async () => {
  orgs = await createEmailOrgs(service.prisma, service.user.id)
})

const tokenFor = (
  organizationSlug: string,
  outreachEmailId: number,
  email = 'pat@example.com',
) => {
  const key = unsubscribeSigningKey()
  if (!key) throw new Error('the test env has no signing key')
  return signUnsubscribeToken(key, {
    email,
    organizationSlug,
    outreachEmailId,
    issuedAt: Date.now(),
  })
}

const winSend = async () => {
  const sender = await createSender(service.prisma, orgs.winSlug)
  const send = await createSend(service.prisma, {
    organizationSlug: orgs.winSlug,
    campaignId: orgs.campaignId,
    senderId: sender.id,
    emails: ['pat@example.com'],
  })
  return { sender, ...send }
}

const suppressionFor = (organizationSlug: string) =>
  service.prisma.outreachEmailSuppression.findFirst({
    where: { organizationSlug, email: 'pat@example.com' },
  })

const unsubscribedCount = async (outreachEmailId: number) =>
  (
    await service.prisma.outreachEmail.findUniqueOrThrow({
      where: { id: outreachEmailId },
    })
  ).unsubscribedCount

describe('unsubscribe', () => {
  it('loads the page state without changing anything', async () => {
    const { outreachEmailId } = await winSend()
    const res = await service.client.get(
      `/v1/email/unsubscribe?t=${tokenFor(orgs.winSlug, outreachEmailId)}`,
    )
    expect(res.status).toBe(200)
    expect(res.data).toEqual({
      senderName: 'Jane Doe',
      mode: 'win',
      unsubscribed: false,
    })
    expect(await suppressionFor(orgs.winSlug)).toBeNull()
  })

  it('says serve for an office organization', async () => {
    const sender = await createSender(service.prisma, orgs.officeSlug)
    const send = await createSend(service.prisma, {
      organizationSlug: orgs.officeSlug,
      campaignId: null,
      senderId: sender.id,
      emails: ['pat@example.com'],
    })
    const res = await service.client.get(
      `/v1/email/unsubscribe?t=${tokenFor(orgs.officeSlug, send.outreachEmailId)}`,
    )
    expect(res.data.mode).toBe('serve')
  })

  it('rejects a tampered or unknown token', async () => {
    const { outreachEmailId } = await winSend()
    const token = tokenFor(orgs.winSlug, outreachEmailId)
    const tampered = `${token.slice(0, -2)}xx`
    expect(
      (await service.client.get(`/v1/email/unsubscribe?t=${tampered}`)).status,
    ).toBe(400)
    expect(
      (await service.client.post('/v1/email/unsubscribe', { token: 'nope' }))
        .status,
    ).toBe(400)
    expect(await suppressionFor(orgs.winSlug)).toBeNull()
  })

  it('unsubscribes on POST, counts it once and is idempotent', async () => {
    const { outreachEmailId } = await winSend()
    const token = tokenFor(orgs.winSlug, outreachEmailId)
    const first = await service.client.post('/v1/email/unsubscribe', { token })
    expect(first.status).toBe(200)
    expect(first.data.unsubscribed).toBe(true)
    await service.client.post('/v1/email/unsubscribe', { token })

    expect(await suppressionFor(orgs.winSlug)).toMatchObject({
      reason: 'link',
      revokedAt: null,
    })
    expect(await unsubscribedCount(outreachEmailId)).toBe(1)
    const state = await service.client.get(`/v1/email/unsubscribe?t=${token}`)
    expect(state.data.unsubscribed).toBe(true)
  })

  it('undoes, then a later unsubscribe clears revokedAt and counts again', async () => {
    const { outreachEmailId } = await winSend()
    const token = tokenFor(orgs.winSlug, outreachEmailId)
    await service.client.post('/v1/email/unsubscribe', { token })

    const undo = await service.client.post('/v1/email/unsubscribe/undo', {
      token,
    })
    expect(undo.data.unsubscribed).toBe(false)
    expect((await suppressionFor(orgs.winSlug))?.revokedAt).not.toBeNull()
    expect(await unsubscribedCount(outreachEmailId)).toBe(0)

    await service.client.post('/v1/email/unsubscribe', { token })
    expect(await suppressionFor(orgs.winSlug)).toMatchObject({
      revokedAt: null,
    })
    expect(await unsubscribedCount(outreachEmailId)).toBe(1)
  })

  it('keeps an unsubscribe to the organization in the token', async () => {
    const { outreachEmailId } = await winSend()
    await service.client.post('/v1/email/unsubscribe', {
      token: tokenFor(orgs.winSlug, outreachEmailId),
    })
    expect(await suppressionFor(orgs.officeSlug)).toBeNull()
  })

  describe('one-click', () => {
    it('accepts a form-encoded body with a 200 and no redirect', async () => {
      const { outreachEmailId } = await winSend()
      const res = await service.client.post(
        `/v1/email/unsubscribe/one-click?t=${tokenFor(orgs.winSlug, outreachEmailId)}`,
        'List-Unsubscribe=One-Click',
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          maxRedirects: 0,
        },
      )
      expect(res.status).toBe(200)
      expect(res.headers.location).toBeUndefined()
      expect(await suppressionFor(orgs.winSlug)).toMatchObject({
        reason: 'one_click',
      })
    })

    it('accepts a multipart body', async () => {
      const { outreachEmailId } = await winSend()
      const form = new FormData()
      form.append('List-Unsubscribe', 'One-Click')
      const res = await service.client.post(
        `/v1/email/unsubscribe/one-click?t=${tokenFor(orgs.winSlug, outreachEmailId)}`,
        form,
        { maxRedirects: 0 },
      )
      expect(res.status).toBe(200)
      expect(res.headers.location).toBeUndefined()
      expect(await suppressionFor(orgs.winSlug)).toMatchObject({
        reason: 'one_click',
      })
    })

    it('rejects a missing or bad token', async () => {
      expect(
        (await service.client.post('/v1/email/unsubscribe/one-click')).status,
      ).toBe(400)
      expect(
        (await service.client.post('/v1/email/unsubscribe/one-click?t=bad'))
          .status,
      ).toBe(400)
    })
  })
})

describe('forward confirmation', () => {
  const token = 'confirm-token-123'
  const hash = createHash('sha256').update(token).digest('hex')

  const startChange = async (expiresAt: Date) => {
    const sender = await createSender(service.prisma, orgs.winSlug)
    await service.prisma.outreachEmailSender.update({
      where: { id: sender.id },
      data: {
        pendingForwardToEmail: 'new@example.com',
        pendingForwardTokenHash: hash,
        pendingForwardExpiresAt: expiresAt,
      },
    })
    return sender
  }

  const sendEmail = vi.fn()
  beforeEach(() => {
    sendEmail.mockReset().mockResolvedValue(undefined)
    vi.spyOn(service.app.get(EmailService), 'sendEmail').mockImplementation(
      sendEmail,
    )
  })

  it('changes nothing on GET', async () => {
    const sender = await startChange(addHours(new Date(), 1))
    const res = await service.client.get(`/v1/email/forward-confirm/${token}`)
    expect(res.status).toBe(200)
    expect(res.data).toEqual({
      senderName: 'Jane Doe',
      forwardToEmail: 'new@example.com',
    })
    const after = await service.prisma.outreachEmailSender.findUniqueOrThrow({
      where: { id: sender.id },
    })
    expect(after.forwardToEmail).toBe('jane@example.com')
    expect(after.pendingForwardToEmail).toBe('new@example.com')
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('confirms on POST and tells the old address', async () => {
    const sender = await startChange(addHours(new Date(), 1))
    const res = await service.client.post('/v1/email/forward-confirm', {
      token,
    })
    expect(res.status).toBe(200)
    expect(res.data.forwardToEmail).toBe('new@example.com')
    const after = await service.prisma.outreachEmailSender.findUniqueOrThrow({
      where: { id: sender.id },
    })
    expect(after).toMatchObject({
      forwardToEmail: 'new@example.com',
      pendingForwardToEmail: null,
      pendingForwardTokenHash: null,
    })
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'jane@example.com' }),
    )
    const again = await service.client.post('/v1/email/forward-confirm', {
      token,
    })
    expect(again.status).toBe(400)
  })

  it('still confirms when the notice to the old address fails', async () => {
    await startChange(addHours(new Date(), 1))
    sendEmail.mockRejectedValue(new Error('mailgun down'))
    const res = await service.client.post('/v1/email/forward-confirm', {
      token,
    })
    expect(res.status).toBe(200)
  })

  it('refuses an expired or unknown token', async () => {
    await startChange(subHours(new Date(), 1))
    expect(
      (await service.client.get(`/v1/email/forward-confirm/${token}`)).status,
    ).toBe(400)
    expect(
      (await service.client.post('/v1/email/forward-confirm', { token }))
        .status,
    ).toBe(400)
    expect(
      (await service.client.post('/v1/email/forward-confirm', { token: 'x' }))
        .status,
    ).toBe(400)
    expect(sendEmail).not.toHaveBeenCalled()
  })
})

describe('SNS webhook', () => {
  const signer = makeSnsSigner()
  const sendMessage = vi.fn()
  const fetchCertificate = vi.fn()
  const fetchSubscribeUrl = vi.fn()

  const received = (key = 'inbound/abc') =>
    JSON.stringify({
      notificationType: 'Received',
      receipt: {
        action: {
          type: 'S3',
          bucketName: 'email-inbound-test',
          objectKey: key,
        },
      },
    })

  const post = (body: object | string) =>
    service.client.post(
      '/v1/email/webhooks/sns',
      typeof body === 'string' ? body : JSON.stringify(body),
      { headers: { 'Content-Type': 'text/plain; charset=UTF-8' } },
    )

  beforeEach(() => {
    sendMessage.mockReset().mockResolvedValue(undefined)
    fetchCertificate.mockReset().mockResolvedValue(signer.certificatePem)
    fetchSubscribeUrl.mockReset().mockResolvedValue(undefined)
    vi.spyOn(
      service.app.get(QueueProducerService),
      'sendMessage',
    ).mockImplementation(sendMessage)
    const webhook = service.app.get(EmailSnsWebhookService)
    vi.spyOn(webhook, 'fetchCertificate').mockImplementation(fetchCertificate)
    vi.spyOn(webhook, 'fetchSubscribeUrl').mockImplementation(fetchSubscribeUrl)
  })

  it('enqueues a verified reply and answers 200 after it succeeds', async () => {
    const res = await post(
      signer.sign({ Message: received(), MessageId: 'm-9' }),
    )
    expect(res.status).toBe(200)
    expect(sendMessage).toHaveBeenCalledWith(
      {
        type: QueueType.EMAIL_INBOUND,
        data: {
          snsMessageId: 'm-9',
          bucket: 'email-inbound-test',
          key: 'inbound/abc',
          fromAuthenticated: false,
        },
      },
      'emailInbound-inbound/abc',
      { throwOnError: true, deduplicationId: 'emailInbound-m-9' },
    )
  })

  it("passes SES's DMARC verdict along", async () => {
    const withVerdict = JSON.stringify({
      notificationType: 'Received',
      receipt: {
        dmarcVerdict: { status: 'PASS' },
        action: {
          type: 'S3',
          bucketName: 'email-inbound-test',
          objectKey: 'inbound/abc',
        },
      },
    })
    await post(signer.sign({ Message: withVerdict }))
    expect(sendMessage.mock.calls[0]?.[0].data.fromAuthenticated).toBe(true)
  })

  it('does not answer 200 when the enqueue fails, so SNS retries', async () => {
    sendMessage.mockRejectedValue(new Error('SQS down'))
    const res = await post(signer.sign({ Message: received() }))
    expect(res.status).toBe(500)
  })

  it('refuses a tampered body', async () => {
    const message = signer.sign({ Message: received() })
    const res = await post({ ...message, Message: received('inbound/evil') })
    expect(res.status).toBe(403)
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('refuses a message signed by another key', async () => {
    const res = await post(makeSnsSigner().sign({ Message: received() }))
    expect(res.status).toBe(403)
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it("refuses a topic that is not this environment's", async () => {
    const res = await post(
      signer.sign({
        Message: received(),
        TopicArn: 'arn:aws:sns:us-west-2:000000000000:email-inbound-prod',
      }),
    )
    expect(res.status).toBe(403)
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('never fetches a certificate from another host', async () => {
    const res = await post(
      signer.sign({
        Message: received(),
        SigningCertURL:
          'https://evil.example.com/SimpleNotificationService-a.pem',
      }),
    )
    expect(res.status).toBe(403)
    expect(fetchCertificate).not.toHaveBeenCalled()
  })

  it('rejects a body that is not an SNS message', async () => {
    expect((await post('not json')).status).toBe(400)
    expect((await post({ Type: 'Notification' })).status).toBe(400)
  })

  it('ignores a notification that is not a received message', async () => {
    const res = await post(
      signer.sign({ Message: 'Successfully validated SNS topic' }),
    )
    expect(res.status).toBe(200)
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('confirms a subscription for the allowed topic', async () => {
    const SubscribeURL =
      'https://sns.us-west-2.amazonaws.com/?Action=ConfirmSubscription&Token=t'
    const res = await post(
      signer.sign({
        Type: 'SubscriptionConfirmation',
        Token: 't',
        SubscribeURL,
      }),
    )
    expect(res.status).toBe(200)
    expect(fetchSubscribeUrl).toHaveBeenCalledWith(SubscribeURL)
  })

  it('does not follow a subscribe URL on another host', async () => {
    const res = await post(
      signer.sign({
        Type: 'SubscriptionConfirmation',
        Token: 't',
        SubscribeURL: 'https://evil.example.com/?Action=ConfirmSubscription',
      }),
    )
    expect(res.status).toBe(403)
    expect(fetchSubscribeUrl).not.toHaveBeenCalled()
  })
})
