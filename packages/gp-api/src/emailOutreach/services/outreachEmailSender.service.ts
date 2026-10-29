import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common'
import { createHash, randomBytes } from 'crypto'
import { addHours, subHours } from 'date-fns'
import { EmailForwardConfirmState, EmailSender } from '@goodparty_org/contracts'
import { EmailService } from '@/email/email.service'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { isUniqueConstraintError } from '@/prisma/util/prismaErrors.util'
import { APP_ROOT } from '@/shared/util/appEnvironment.util'
import { OutreachEmailSender } from '../../generated/prisma'
import {
  EMAIL_OUTREACH_DOMAIN,
  FORWARD_CONFIRM_MAX_PER_DAY,
  FORWARD_CONFIRM_TTL_HOURS,
} from '../emailOutreach.const'
import { EmailSendScope } from '../emailOutreach.types'
import { buildLocalPartBase, withSuffix } from '../util/localPart.util'

const MAX_CREATE_ATTEMPTS = 5

@Injectable()
export class OutreachEmailSenderService extends createPrismaBase(
  MODELS.OutreachEmailSender,
) {
  constructor(private readonly emailService: EmailService) {
    super()
  }

  toView(sender: OutreachEmailSender): EmailSender {
    return {
      localPart: sender.localPart,
      address: `${sender.localPart}@${EMAIL_OUTREACH_DOMAIN}`,
      displayName: sender.displayName,
      forwardToEmail: sender.forwardToEmail,
      pendingForwardToEmail: sender.pendingForwardToEmail,
      warmingStep: sender.warmingStep,
    }
  }

  async findOrCreate(scope: EmailSendScope): Promise<OutreachEmailSender> {
    const existing = await this.model.findUnique({
      where: { organizationSlug: scope.organizationSlug },
    })
    if (existing) {
      return existing
    }

    const base =
      buildLocalPartBase(
        scope.senderName,
        scope.fallbackName,
        scope.organizationSlug,
      ) ?? 'sender'
    const forwardToEmail = scope.forwardToCandidates.find(
      (email): email is string => !!email,
    )
    if (!forwardToEmail) {
      throw new ConflictException('No email address to forward replies to')
    }

    for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt++) {
      const localPart = await this.nextFreeLocalPart(base)
      try {
        return await this.model.create({
          data: {
            organizationSlug: scope.organizationSlug,
            localPart,
            displayName: scope.senderName || scope.fallbackName,
            forwardToEmail,
          },
        })
      } catch (err) {
        if (!isUniqueConstraintError(err)) {
          throw err
        }
        const raced = await this.model.findUnique({
          where: { organizationSlug: scope.organizationSlug },
        })
        if (raced) {
          return raced
        }
      }
    }
    throw new ConflictException('Could not reserve a sender address')
  }

  async startForwardChange(
    scope: EmailSendScope,
    requestedEmail: string,
  ): Promise<OutreachEmailSender> {
    const sender = await this.findOrCreate(scope)
    const email = requestedEmail.trim().toLowerCase()

    if (email === sender.forwardToEmail.toLowerCase()) {
      return this.model.update({
        where: { id: sender.id },
        data: {
          pendingForwardToEmail: null,
          pendingForwardTokenHash: null,
          pendingForwardExpiresAt: null,
        },
      })
    }

    const slotId = await this.reserveConfirmationEmail(sender)

    const token = randomBytes(32).toString('base64url')
    const updated = await this.model.update({
      where: { id: sender.id },
      data: {
        pendingForwardToEmail: email,
        pendingForwardTokenHash: createHash('sha256')
          .update(token)
          .digest('hex'),
        pendingForwardExpiresAt: addHours(
          new Date(),
          FORWARD_CONFIRM_TTL_HOURS,
        ),
      },
    })

    const link = `${APP_ROOT}/email/forward-confirm/${token}`
    try {
      await this.emailService.sendEmail({
        to: email,
        subject: `Confirm where replies to ${sender.displayName}'s emails go`,
        message:
          `Replies to ${sender.displayName}'s emails will come to this ` +
          `address once you confirm it.\n\nConfirm: ${link}\n\n` +
          `This link works for ${FORWARD_CONFIRM_TTL_HOURS} hours.`,
      })
    } catch (err) {
      this.logger.warn({ err }, 'forward-to confirmation email failed')
      await this.client.outreachEmailForwardConfirmation.deleteMany({
        where: { id: slotId },
      })
      throw new BadGatewayException('Could not send the confirmation email')
    }
    return updated
  }

  // Counting under the sender row lock keeps the cap right across tasks.
  private async reserveConfirmationEmail(
    sender: OutreachEmailSender,
  ): Promise<number> {
    return this.client.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT id FROM outreach_email_sender WHERE id = ${sender.id} FOR UPDATE
      `
      const sent = await tx.outreachEmailForwardConfirmation.count({
        where: {
          senderId: sender.id,
          createdAt: { gt: subHours(new Date(), 24) },
        },
      })
      if (sent >= FORWARD_CONFIRM_MAX_PER_DAY) {
        throw new HttpException(
          "You've changed your reply address too many times today. Try again tomorrow.",
          HttpStatus.TOO_MANY_REQUESTS,
        )
      }
      const slot = await tx.outreachEmailForwardConfirmation.create({
        data: { senderId: sender.id },
      })
      return slot.id
    })
  }

  // Loading the confirmation page changes nothing; only confirmForward does.
  async describeForwardChange(
    token: string,
  ): Promise<EmailForwardConfirmState> {
    const sender = await this.findPendingByToken(token)
    return {
      senderName: sender.displayName,
      forwardToEmail: sender.pendingForwardToEmail ?? '',
    }
  }

  async confirmForward(token: string): Promise<EmailForwardConfirmState> {
    const sender = await this.findPendingByToken(token)
    const newEmail = sender.pendingForwardToEmail ?? ''
    const claimed = await this.model.updateMany({
      where: {
        id: sender.id,
        pendingForwardTokenHash: sender.pendingForwardTokenHash,
        pendingForwardExpiresAt: { gt: new Date() },
      },
      data: {
        forwardToEmail: newEmail,
        pendingForwardToEmail: null,
        pendingForwardTokenHash: null,
        pendingForwardExpiresAt: null,
      },
    })
    if (claimed.count === 0) {
      throw new BadRequestException('This link is not valid')
    }
    try {
      await this.emailService.sendEmail({
        to: sender.forwardToEmail,
        subject: `Replies to ${sender.displayName}'s emails now go elsewhere`,
        message:
          `Replies to ${sender.displayName}'s emails now go to ${newEmail}. ` +
          `If you didn't ask for this, contact GoodParty support.`,
      })
    } catch (err) {
      this.logger.warn({ err }, 'forward-to change notice failed')
    }
    return { senderName: sender.displayName, forwardToEmail: newEmail }
  }

  private async findPendingByToken(
    token: string,
  ): Promise<OutreachEmailSender> {
    const sender = await this.model.findFirst({
      where: {
        pendingForwardTokenHash: createHash('sha256')
          .update(token)
          .digest('hex'),
        pendingForwardToEmail: { not: null },
        pendingForwardExpiresAt: { gt: new Date() },
      },
    })
    if (!sender) {
      throw new BadRequestException('This link is not valid')
    }
    return sender
  }

  private async nextFreeLocalPart(base: string): Promise<string> {
    const taken = new Set(
      (
        await this.model.findMany({
          where: { localPart: { startsWith: base } },
          select: { localPart: true },
        })
      ).map((row) => row.localPart),
    )
    let attempt = 1
    while (taken.has(withSuffix(base, attempt))) {
      attempt++
    }
    return withSuffix(base, attempt)
  }
}
