import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { addDays, isAfter, isBefore, parseISO, subMinutes } from 'date-fns'
import {
  EMAIL_SEND_WINDOW_DAYS,
  EmailDraft,
  EmailDraftSave,
  EmailSend,
} from '@goodparty_org/contracts'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import {
  OutreachEmail,
  OutreachStatus,
  OutreachType,
  Prisma,
} from '../../generated/prisma'
import { EmailSendScope } from '../emailOutreach.types'
import {
  emailPriceCents,
  recipientCapFor,
  warmingCapFor,
} from '../util/emailPricing.util'
import { OutreachEmailAudienceService } from './outreachEmailAudience.service'
import { assertEmailImageUrl } from './outreachEmailImage.service'
import { OutreachEmailSenderService } from './outreachEmailSender.service'

type DraftRow = OutreachEmail & {
  outreach: {
    status: OutreachStatus | null
    date: Date | null
    voterFileFilterId: number | null
  }
  sender: { warmingStep: number }
  _count: { recipients: number }
}

// A confirmed send holds its cap against the sender's warming step until it
// finishes.
export const RESERVING_STATUSES: OutreachStatus[] = [
  OutreachStatus.pending_payment,
  OutreachStatus.pending,
  OutreachStatus.in_progress,
]

const DATE_SLACK_MINUTES = 5

@Injectable()
export class OutreachEmailService extends createPrismaBase(
  MODELS.OutreachEmail,
) {
  constructor(
    private readonly senders: OutreachEmailSenderService,
    private readonly audiences: OutreachEmailAudienceService,
  ) {
    super()
  }

  scopeWhere(
    scope: EmailSendScope,
    outreachId: number,
  ): Prisma.OutreachEmailWhereInput {
    return {
      outreachId,
      outreach: {
        outreachType: OutreachType.email,
        organizationSlug: scope.organizationSlug,
        campaignId: scope.campaignId,
      },
    }
  }

  async findDraftOrThrow(
    scope: EmailSendScope,
    outreachId: number,
  ): Promise<DraftRow> {
    const row = await this.model.findFirst({
      where: this.scopeWhere(scope, outreachId),
      include: {
        outreach: {
          select: { status: true, date: true, voterFileFilterId: true },
        },
        sender: { select: { warmingStep: true } },
        _count: { select: { recipients: true } },
      },
    })
    if (!row) {
      throw new NotFoundException('Email not found')
    }
    return row
  }

  async reservedBySender(
    senderId: number,
    excludeOutreachEmailId: number,
    tx: Prisma.TransactionClient = this.client,
  ): Promise<number> {
    const reserved = await tx.outreachEmail.aggregate({
      where: {
        senderId,
        id: { not: excludeOutreachEmailId },
        outreach: { status: { in: RESERVING_STATUSES } },
      },
      _sum: { recipientCap: true },
    })
    return reserved._sum.recipientCap ?? 0
  }

  async findWithSenderOrThrow(scope: EmailSendScope, outreachId: number) {
    const row = await this.model.findFirst({
      where: this.scopeWhere(scope, outreachId),
      include: {
        outreach: { select: { status: true, date: true } },
        sender: true,
      },
    })
    if (!row) {
      throw new NotFoundException('Email not found')
    }
    return row
  }

  async get(scope: EmailSendScope, outreachId: number): Promise<EmailSend> {
    const row = await this.findDraftOrThrow(scope, outreachId)
    const { voterFileFilterId } = row.outreach
    if (
      row.outreach.status !== OutreachStatus.draft ||
      voterFileFilterId === null ||
      !scope.canReadVoterFile
    ) {
      return this.toView(row, null)
    }
    const audienceCount = await this.audiences.countWithEmail(
      scope.organizationSlug,
      voterFileFilterId,
    )
    const recipientCap = recipientCapFor({
      warmingStep: row.sender.warmingStep,
      reservedByOtherSends: await this.reservedBySender(row.senderId, row.id),
      recipientCount: audienceCount,
    })
    return this.toView(row, {
      audienceCount,
      warmingCap: warmingCapFor(row.sender.warmingStep),
      recipientCap,
      priceCents: emailPriceCents(recipientCap),
    })
  }

  async saveDraft(
    scope: EmailSendScope,
    input: EmailDraftSave,
    userId: number,
  ): Promise<EmailDraft> {
    assertEmailImageUrl(scope, input.imageUrl)
    const voterFileFilterId = input.voterFileFilterId ?? null
    if (voterFileFilterId !== null) {
      await this.audiences.assertListBelongs(
        scope.organizationSlug,
        voterFileFilterId,
      )
    }
    const consent = input.consentConfirmed
      ? { consentConfirmedAt: new Date(), consentConfirmedByUserId: userId }
      : { consentConfirmedAt: null, consentConfirmedByUserId: null }
    const content = {
      goal: input.goal,
      layout: input.layout,
      theme: input.theme,
      subject: input.subject,
      headline: input.headline ?? null,
      body: input.body,
      imageUrl: input.imageUrl ?? null,
      buttonLabel: input.buttonLabel ?? null,
      buttonUrl: input.buttonUrl ?? null,
      paidForBy: scope.paidForBy,
    }

    if (input.id === undefined) {
      const sender = await this.senders.findOrCreate(scope)
      const date = this.parseSendDate(input.date)
      const created = await this.client.outreach.create({
        data: {
          outreachType: OutreachType.email,
          status: OutreachStatus.draft,
          campaignId: scope.campaignId,
          organizationSlug: scope.organizationSlug,
          name: input.subject,
          date,
          voterFileFilterId,
          email: {
            create: { ...content, ...consent, senderId: sender.id },
          },
        },
      })
      return this.draftView(scope, created.id)
    }

    const existing = await this.findDraftOrThrow(scope, input.id)
    if (existing.outreach.status !== OutreachStatus.draft) {
      throw new ConflictException('Only a draft can be edited')
    }
    const unchangedDate =
      input.date !== undefined &&
      existing.outreach.date?.getTime() === parseISO(input.date).getTime()
    const date = unchangedDate
      ? existing.outreach.date
      : this.parseSendDate(input.date)
    // Consent given for this list stays dated from when it was given; a new
    // list needs it again.
    const keptConsent =
      input.consentConfirmed === true &&
      existing.consentConfirmedAt !== null &&
      existing.outreach.voterFileFilterId === voterFileFilterId
        ? {}
        : consent
    await this.client.$transaction(async (tx) => {
      const claim = await tx.outreach.updateMany({
        where: { id: input.id, status: OutreachStatus.draft },
        data: { name: input.subject, date, voterFileFilterId },
      })
      if (claim.count === 0) {
        throw new ConflictException('Only a draft can be edited')
      }
      await tx.outreachEmail.update({
        where: { outreachId: input.id },
        data: { ...content, ...keptConsent },
      })
    })
    return this.draftView(scope, input.id)
  }

  // The save answers the draft alone; the estimate's count is read by GET.
  private async draftView(
    scope: EmailSendScope,
    outreachId: number,
  ): Promise<EmailDraft> {
    return this.toView(await this.findDraftOrThrow(scope, outreachId), null)
  }

  private parseSendDate(raw: string | undefined): Date | null {
    if (raw === undefined) {
      return null
    }
    const date = parseISO(raw)
    const now = new Date()
    if (isBefore(date, subMinutes(now, DATE_SLACK_MINUTES))) {
      throw new BadRequestException('The send time is in the past')
    }
    if (isAfter(date, addDays(now, EMAIL_SEND_WINDOW_DAYS))) {
      throw new BadRequestException(
        `Emails can be scheduled up to ${EMAIL_SEND_WINDOW_DAYS} days ahead`,
      )
    }
    return date
  }

  private toView(row: DraftRow, estimate: EmailSend['estimate']): EmailSend {
    return {
      id: row.outreachId,
      status: row.outreach.status ?? OutreachStatus.pending,
      goal: row.goal,
      layout: row.layout,
      theme: row.theme,
      subject: row.subject,
      headline: row.headline,
      body: row.body,
      imageUrl: row.imageUrl,
      buttonLabel: row.buttonLabel,
      buttonUrl: row.buttonUrl,
      paidForBy: row.paidForBy,
      date: row.outreach.date?.toISOString() ?? null,
      consentConfirmedAt: row.consentConfirmedAt?.toISOString() ?? null,
      voterFileFilterId: row.outreach.voterFileFilterId,
      recipientCount: row._count.recipients,
      recipientCap: row.recipientCap,
      sentCount: row.sentCount,
      pauseReason: row.pauseReason,
      stopping: row.stoppingAt !== null,
      estimate,
    }
  }
}
