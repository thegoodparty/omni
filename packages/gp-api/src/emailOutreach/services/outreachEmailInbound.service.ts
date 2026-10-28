import { Injectable } from '@nestjs/common'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { isUniqueConstraintError } from '@/prisma/util/prismaErrors.util'
import { S3Service } from '@/vendors/aws/services/s3.service'
import {
  OutreachEmailRecipientStatus,
  OutreachEmailReply,
  OutreachEmailReplyClass,
  OutreachEmailSender,
} from '../../generated/prisma'
import { EMAIL_OUTREACH_DOMAIN } from '../emailOutreach.const'
import {
  MimeAddress,
  ParsedMime,
  headerValue,
  parseAddresses,
  parseMime,
  readHeader,
  stripQuotedReply,
} from '../util/emailMime.util'
import { OutreachEmailUnsubscribeService } from './outreachEmailUnsubscribe.service'
import { FORWARD_MARKER_HEADER, SesService } from './ses.service'

const INBOUND_BUCKET_PREFIX = 'email-inbound-'
const MAX_FORWARD_CHARS = 100_000
const MAX_DISPLAY_NAME_CHARS = 60
const STOP_WORDS =
  /^(please\s+)?(stop|unsubscribe|remove me|remove|opt[\s-]?out)\b/i
const STOP_MAX_CHARS = 200
const AUTO_REPLY_SUBJECT =
  /^\s*(automatic reply|auto[\s-]?reply|autoreply|out of (the )?office)/i
const SYSTEM_SENDERS = new Set(['mailer-daemon', 'postmaster'])

const oneLine = (value: string): string => value.replace(/[\r\n]+/g, ' ').trim()

const displayNameFor = (from: MimeAddress): string => {
  const base = from.name ?? from.address.split('@')[0] ?? from.address
  const clean = oneLine(base)
    .replace(/["\\<>]/g, '')
    .slice(0, MAX_DISPLAY_NAME_CHARS)
  return `${clean || 'Someone'} via GoodParty`
}

@Injectable()
export class OutreachEmailInboundService extends createPrismaBase(
  MODELS.OutreachEmailReply,
) {
  constructor(
    private readonly s3: S3Service,
    private readonly ses: SesService,
    private readonly unsubscribes: OutreachEmailUnsubscribeService,
  ) {
    super()
  }

  // Idempotent on the object key: a redelivered message finds its reply row
  // and only finishes work that hadn't gone through.
  async process(bucket: string, key: string): Promise<void> {
    if (!bucket.startsWith(INBOUND_BUCKET_PREFIX)) {
      this.logger.error({ bucket, key }, 'inbound reply from an unknown bucket')
      return
    }
    const existing = await this.model.findUnique({
      where: { rawObjectKey: key },
    })
    if (existing && !this.needsWork(existing)) return

    const raw = await this.s3.getFileBytes(bucket, key)
    if (!raw) {
      throw new Error(`Inbound message ${key} is not in ${bucket}`)
    }
    const mime = parseMime(raw)
    const from = parseAddresses(readHeader(mime.headers, 'from'))[0]
    const sender = await this.findSender(mime)
    if (!from || !sender) {
      this.logger.warn({ key }, 'inbound reply has no known sender or From')
      return
    }

    const subject = readHeader(mime.headers, 'subject') ?? null
    const classification = this.classify(mime, from, subject)
    const outreachEmailId = await this.matchSend(sender.id, from.address)

    // Suppress before saving the reply, so a saved unsubscribe reply means
    // it was applied. A redelivery then never re-applies it after an undo.
    if (!existing && classification === OutreachEmailReplyClass.unsubscribe) {
      await this.unsubscribes.suppress({
        email: from.address,
        organizationSlug: sender.organizationSlug,
        outreachEmailId,
        reason: 'reply',
      })
    }
    const reply =
      existing ??
      (await this.saveReply(
        sender.id,
        outreachEmailId,
        from.address,
        subject,
        key,
        classification,
      ))
    if (reply?.classification === OutreachEmailReplyClass.forwarded) {
      await this.forward(reply, sender, from, subject, mime)
    }
  }

  classify(
    mime: ParsedMime,
    from: MimeAddress,
    subject: string | null,
  ): OutreachEmailReplyClass {
    const { headers } = mime
    const localPart = from.address.split('@')[0] ?? ''
    const domain = from.address.split('@')[1] ?? ''
    if (
      headers.has(FORWARD_MARKER_HEADER.toLowerCase()) ||
      domain === EMAIL_OUTREACH_DOMAIN
    ) {
      return OutreachEmailReplyClass.auto_reply
    }
    if (
      headerValue(headers, 'x-ses-spam-verdict')?.toUpperCase() === 'FAIL' ||
      headerValue(headers, 'x-ses-virus-verdict')?.toUpperCase() === 'FAIL'
    ) {
      return OutreachEmailReplyClass.spam
    }
    const contentType = headerValue(headers, 'content-type') ?? ''
    if (
      /multipart\/report/i.test(contentType) ||
      SYSTEM_SENDERS.has(localPart) ||
      headers.has('x-failed-recipients')
    ) {
      return OutreachEmailReplyClass.bounce
    }
    const autoSubmitted = headerValue(headers, 'auto-submitted')
    const precedence = headerValue(headers, 'precedence')?.toLowerCase()
    if (
      (autoSubmitted && autoSubmitted.toLowerCase() !== 'no') ||
      (precedence && ['bulk', 'junk', 'auto_reply'].includes(precedence)) ||
      headers.has('x-autoreply') ||
      headers.has('x-autorespond') ||
      (subject && AUTO_REPLY_SUBJECT.test(subject))
    ) {
      return OutreachEmailReplyClass.auto_reply
    }
    // A stop reply counts only from an address SES could authenticate, so a
    // forged one can't unsubscribe someone else.
    const authenticated =
      headerValue(headers, 'x-ses-spf-verdict')?.toUpperCase() === 'PASS' ||
      headerValue(headers, 'x-ses-dkim-verdict')?.toUpperCase() === 'PASS'
    if (!authenticated) return OutreachEmailReplyClass.forwarded
    const written = stripQuotedReply(mime.text)
    const firstLine = written.split('\n').find((line) => line.trim()) ?? ''
    if (
      (written.length <= STOP_MAX_CHARS && STOP_WORDS.test(firstLine.trim())) ||
      (written === '' && /^\s*(re:\s*)?unsubscribe\s*$/i.test(subject ?? ''))
    ) {
      return OutreachEmailReplyClass.unsubscribe
    }
    return OutreachEmailReplyClass.forwarded
  }

  private needsWork(reply: OutreachEmailReply): boolean {
    return (
      reply.classification === OutreachEmailReplyClass.forwarded &&
      reply.forwardedAt === null
    )
  }

  private async findSender(
    mime: ParsedMime,
  ): Promise<OutreachEmailSender | null> {
    const recipients = ['to', 'cc', 'delivered-to', 'x-original-to'].flatMap(
      (name) =>
        (mime.headers.get(name) ?? []).flatMap((value) =>
          parseAddresses(value),
        ),
    )
    const local = recipients
      .filter((r) => r.address.endsWith(`@${EMAIL_OUTREACH_DOMAIN}`))
      .map((r) => r.address.split('@')[0])
      .find((part): part is string => !!part)
    if (!local) return null
    return this.client.outreachEmailSender.findUnique({
      where: { localPart: local },
    })
  }

  // The latest send to this address from this sender, so a reply to an old
  // send is still matched to it.
  private async matchSend(
    senderId: number,
    email: string,
  ): Promise<number | null> {
    const recipient = await this.client.outreachEmailRecipient.findFirst({
      where: {
        senderId,
        email,
        status: OutreachEmailRecipientStatus.sent,
      },
      orderBy: { sentAt: 'desc' },
      select: { outreachEmailId: true },
    })
    return recipient?.outreachEmailId ?? null
  }

  private async saveReply(
    senderId: number,
    outreachEmailId: number | null,
    fromEmail: string,
    subject: string | null,
    key: string,
    classification: OutreachEmailReplyClass,
  ): Promise<OutreachEmailReply | null> {
    try {
      return await this.model.create({
        data: {
          senderId,
          outreachEmailId,
          fromEmail,
          subject: subject?.slice(0, 500) ?? null,
          rawObjectKey: key,
          classification,
        },
      })
    } catch (err) {
      if (isUniqueConstraintError(err)) return null
      throw err
    }
  }

  private async forward(
    reply: OutreachEmailReply,
    sender: OutreachEmailSender,
    from: MimeAddress,
    subject: string | null,
    mime: ParsedMime,
  ): Promise<void> {
    const body = mime.text.slice(0, MAX_FORWARD_CHARS) || '(no message)'
    await this.ses.forwardReply({
      from: `${sender.localPart}@${EMAIL_OUTREACH_DOMAIN}`,
      fromName: displayNameFor(from),
      replyTo: from.address,
      to: sender.forwardToEmail,
      subject: oneLine(subject ?? '') || '(no subject)',
      text: `From: ${from.address}\n\n${body}`,
    })
    await this.model.update({
      where: { id: reply.id },
      data: { forwardedAt: new Date() },
    })
  }
}
