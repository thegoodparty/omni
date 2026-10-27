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
} from '@goodparty_org/contracts'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import {
  OutreachEmail,
  OutreachStatus,
  OutreachType,
  Prisma,
} from '../../generated/prisma'
import { EmailSendScope } from '../emailOutreach.types'
import { OutreachEmailSenderService } from './outreachEmailSender.service'

type DraftRow = OutreachEmail & {
  outreach: { status: OutreachStatus | null; date: Date | null }
  _count: { recipients: number }
}

const DATE_SLACK_MINUTES = 5

@Injectable()
export class OutreachEmailService extends createPrismaBase(
  MODELS.OutreachEmail,
) {
  constructor(private readonly senders: OutreachEmailSenderService) {
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
        outreach: { select: { status: true, date: true } },
        _count: { select: { recipients: true } },
      },
    })
    if (!row) {
      throw new NotFoundException('Email not found')
    }
    return row
  }

  async get(scope: EmailSendScope, outreachId: number): Promise<EmailDraft> {
    return this.toView(await this.findDraftOrThrow(scope, outreachId))
  }

  async saveDraft(
    scope: EmailSendScope,
    input: EmailDraftSave,
  ): Promise<EmailDraft> {
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
          email: { create: { ...content, senderId: sender.id } },
        },
      })
      return this.get(scope, created.id)
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
    await this.client.$transaction(async (tx) => {
      const claim = await tx.outreach.updateMany({
        where: { id: input.id, status: OutreachStatus.draft },
        data: { name: input.subject, date },
      })
      if (claim.count === 0) {
        throw new ConflictException('Only a draft can be edited')
      }
      await tx.outreachEmail.update({
        where: { outreachId: input.id },
        data: content,
      })
    })
    return this.get(scope, input.id)
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

  private toView(row: DraftRow): EmailDraft {
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
      recipientCount: row._count.recipients,
    }
  }
}
