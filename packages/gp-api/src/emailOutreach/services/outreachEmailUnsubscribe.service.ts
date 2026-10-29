import { BadRequestException, Injectable } from '@nestjs/common'
import {
  EmailPublicMode,
  EmailUnsubscribeState,
} from '@goodparty_org/contracts'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { isUniqueConstraintError } from '@/prisma/util/prismaErrors.util'
import { OutreachEmailSuppressionReason } from '../../generated/prisma'
import {
  UnsubscribeTokenPayload,
  unsubscribeSigningKey,
  verifyUnsubscribeToken,
} from '../util/unsubscribeToken.util'

const MESSAGE_TYPE = 'all'

type Suppress = {
  email: string
  organizationSlug: string
  outreachEmailId: number | null
  reason: OutreachEmailSuppressionReason
}

@Injectable()
export class OutreachEmailUnsubscribeService extends createPrismaBase(
  MODELS.OutreachEmailSuppression,
) {
  // The token is signed by us and never expires, so a link in an old email
  // works after its send is gone. Anything else is "not valid".
  private readTokenOrThrow(token: string): UnsubscribeTokenPayload {
    const key = unsubscribeSigningKey()
    const payload = key ? verifyUnsubscribeToken(key, token) : null
    if (!payload) {
      throw new BadRequestException('This link is not valid')
    }
    return payload
  }

  async describe(token: string): Promise<EmailUnsubscribeState> {
    const payload = this.readTokenOrThrow(token)
    const active = await this.model.findFirst({
      where: this.keyFor(payload),
      select: { revokedAt: true },
    })
    return {
      ...(await this.pageContext(payload.organizationSlug)),
      unsubscribed: !!active && active.revokedAt === null,
    }
  }

  async unsubscribeByToken(
    token: string,
    reason: OutreachEmailSuppressionReason,
  ): Promise<EmailUnsubscribeState> {
    const payload = this.readTokenOrThrow(token)
    const context = await this.pageContext(payload.organizationSlug)
    await this.suppress({
      email: payload.email,
      organizationSlug: payload.organizationSlug,
      outreachEmailId: payload.outreachEmailId,
      reason,
    })
    return { ...context, unsubscribed: true }
  }

  async undoByToken(token: string): Promise<EmailUnsubscribeState> {
    const payload = this.readTokenOrThrow(token)
    const context = await this.pageContext(payload.organizationSlug)
    const undone = await this.model.updateMany({
      where: { ...this.keyFor(payload), revokedAt: null },
      data: { revokedAt: new Date() },
    })
    if (undone.count > 0) {
      await this.client.outreachEmail.updateMany({
        where: { id: payload.outreachEmailId, unsubscribedCount: { gt: 0 } },
        data: { unsubscribedCount: { decrement: 1 } },
      })
    }
    return { ...context, unsubscribed: false }
  }

  // Idempotent: an address already unsubscribed is left alone and isn't
  // counted twice. A new unsubscribe, or one after an undo, counts once on
  // the send the person unsubscribed from.
  async suppress(input: Suppress): Promise<void> {
    const email = input.email.trim().toLowerCase()
    const where = {
      email,
      organizationSlug: input.organizationSlug,
      messageType: MESSAGE_TYPE,
    }
    const reinstated = await this.model.updateMany({
      where: { ...where, revokedAt: { not: null } },
      data: { revokedAt: null, reason: input.reason },
    })
    let counted = reinstated.count > 0
    if (!counted) {
      try {
        await this.model.create({ data: { ...where, reason: input.reason } })
        counted = true
      } catch (err) {
        if (!isUniqueConstraintError(err)) throw err
      }
    }
    if (counted && input.outreachEmailId !== null) {
      await this.client.outreachEmail.updateMany({
        where: { id: input.outreachEmailId },
        data: { unsubscribedCount: { increment: 1 } },
      })
    }
  }

  private keyFor(payload: UnsubscribeTokenPayload) {
    return {
      email: payload.email.trim().toLowerCase(),
      organizationSlug: payload.organizationSlug,
      messageType: MESSAGE_TYPE,
    }
  }

  private async pageContext(
    organizationSlug: string,
  ): Promise<{ senderName: string; mode: EmailPublicMode }> {
    const sender = await this.client.outreachEmailSender.findUnique({
      where: { organizationSlug },
      select: { displayName: true },
    })
    if (!sender) {
      throw new BadRequestException('This link is not valid')
    }
    const office = await this.client.electedOffice.findUnique({
      where: { organizationSlug },
      select: { id: true },
    })
    return { senderName: sender.displayName, mode: office ? 'serve' : 'win' }
  }
}
