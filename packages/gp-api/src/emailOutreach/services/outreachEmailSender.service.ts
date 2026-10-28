import {
  BadGatewayException,
  ConflictException,
  Injectable,
} from '@nestjs/common'
import { createHash, randomBytes } from 'crypto'
import { addHours } from 'date-fns'
import { EmailSender } from '@goodparty_org/contracts'
import { EmailService } from '@/email/email.service'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { isUniqueConstraintError } from '@/prisma/util/prismaErrors.util'
import { APP_ROOT } from '@/shared/util/appEnvironment.util'
import { OutreachEmailSender } from '../../generated/prisma'
import {
  EMAIL_OUTREACH_DOMAIN,
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
      throw new BadGatewayException('Could not send the confirmation email')
    }
    return updated
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
