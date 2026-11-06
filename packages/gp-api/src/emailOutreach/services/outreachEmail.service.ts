import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { addDays, isAfter, isBefore, parseISO, subMinutes } from 'date-fns'
import {
  EMAIL_SEND_WINDOW_DAYS,
  EmailDeliveryCounts,
  EmailDraft,
  EmailDraftSave,
  EmailSend,
} from '@goodparty_org/contracts'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import {
  OutreachEmail,
  OutreachHoldState,
  OutreachStatus,
  OutreachType,
  Prisma,
} from '../../generated/prisma'
import { EmailSendScope } from '../emailOutreach.types'
import {
  emailContentOf,
  fieldsContent,
  previewableContentOf,
} from '../util/emailContent.util'
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
    paymentHold: { state: OutreachHoldState } | null
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

// Before the send starts nobody has been emailed, so there is nothing to
// count.
const NOT_STARTED_STATUSES: (OutreachStatus | null)[] = [
  OutreachStatus.draft,
  OutreachStatus.pending_payment,
  OutreachStatus.pending,
  null,
]

export const NO_DELIVERIES: EmailDeliveryCounts = {
  sent: 0,
  delivered: 0,
  bounced: 0,
  complained: 0,
  opened: 0,
  clicked: 0,
}

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
          select: {
            status: true,
            date: true,
            voterFileFilterId: true,
            paymentHold: { select: { state: true } },
          },
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
    excludeOutreachEmailId: number | null,
    tx: Prisma.TransactionClient = this.client,
  ): Promise<number> {
    const reserved = await tx.outreachEmail.aggregate({
      where: {
        senderId,
        id:
          excludeOutreachEmailId === null
            ? undefined
            : { not: excludeOutreachEmailId },
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

  // One grouped query for every send asked about. The status moves only
  // forward, so a delivered email that later bounced or was marked as spam
  // still counts as delivered through its deliveredAt.
  async deliveryCounts(
    outreachEmailIds: number[],
  ): Promise<Map<number, EmailDeliveryCounts>> {
    const counts = new Map<number, EmailDeliveryCounts>()
    if (outreachEmailIds.length === 0) return counts
    const rows = await this.client.$queryRaw<
      (EmailDeliveryCounts & { outreach_email_id: number })[]
    >`
      SELECT
        outreach_email_id,
        COUNT(*) FILTER (WHERE sent_at IS NOT NULL)::int AS sent,
        COUNT(*) FILTER (
          WHERE delivered_at IS NOT NULL OR status = 'delivered'
        )::int AS delivered,
        COUNT(*) FILTER (
          WHERE bounced_at IS NOT NULL OR status = 'bounced'
        )::int AS bounced,
        COUNT(*) FILTER (
          WHERE complained_at IS NOT NULL OR status = 'complained'
        )::int AS complained,
        COUNT(*) FILTER (WHERE first_opened_at IS NOT NULL)::int AS opened,
        COUNT(*) FILTER (WHERE first_clicked_at IS NOT NULL)::int AS clicked
      FROM outreach_email_recipient
      WHERE outreach_email_id = ANY(${outreachEmailIds})
      GROUP BY outreach_email_id
    `
    for (const id of outreachEmailIds) counts.set(id, NO_DELIVERIES)
    for (const { outreach_email_id: id, ...row } of rows) counts.set(id, row)
    return counts
  }

  async get(scope: EmailSendScope, outreachId: number): Promise<EmailSend> {
    const row = await this.findDraftOrThrow(scope, outreachId)
    const { voterFileFilterId } = row.outreach
    if (!NOT_STARTED_STATUSES.includes(row.outreach.status)) {
      const counts = await this.deliveryCounts([row.id])
      return this.toView(row, null, counts.get(row.id) ?? NO_DELIVERIES)
    }
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
  ): Promise<EmailDraft> {
    const voterFileFilterId = input.voterFileFilterId ?? null
    if (voterFileFilterId !== null) {
      await this.audiences.assertListBelongs(
        scope.organizationSlug,
        voterFileFilterId,
      )
    }
    const content = this.contentColumns(scope, input)
    const subject = 'content' in input ? input.content.subject : input.subject

    if (input.id === undefined) {
      const sender = await this.senders.findOrCreate(scope)
      const date = this.parseSendDate(input.date)
      const created = await this.client.outreach.create({
        data: {
          outreachType: OutreachType.email,
          status: OutreachStatus.draft,
          campaignId: scope.campaignId,
          organizationSlug: scope.organizationSlug,
          name: subject,
          date,
          voterFileFilterId,
          email: {
            create: { ...content, senderId: sender.id },
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
    await this.client.$transaction(async (tx) => {
      const claim = await tx.outreach.updateMany({
        where: { id: input.id, status: OutreachStatus.draft },
        data: { name: subject, date, voterFileFilterId },
      })
      if (claim.count === 0) {
        throw new ConflictException('Only a draft can be edited')
      }
      await tx.outreachEmail.update({
        where: { outreachId: input.id },
        data: content,
      })
    })
    return this.draftView(scope, input.id)
  }

  // A block draft keeps its blocks in `content` and leaves the fixed fields
  // empty; a fixed-field draft clears `content`, since a save is a full
  // replace.
  private contentColumns(scope: EmailSendScope, input: EmailDraftSave) {
    if ('content' in input) {
      for (const block of input.content.blocks) {
        if (block.type === 'image' && block.url) {
          assertEmailImageUrl(scope, block.url)
        }
      }
      return {
        goal: input.goal,
        layout: input.content.layout,
        theme: input.content.theme,
        subject: input.content.subject,
        headline: null,
        body: '',
        imageUrl: null,
        buttonLabel: null,
        buttonUrl: null,
        content: input.content,
        paidForBy: scope.paidForBy,
      }
    }
    assertEmailImageUrl(scope, input.imageUrl)
    const fields = {
      headline: input.headline ?? null,
      imageUrl: input.imageUrl ?? null,
      buttonLabel: input.buttonLabel ?? null,
      buttonUrl: input.buttonUrl ?? null,
    }
    // Fields are sent as blocks, so the block rules (heading and paragraph
    // length, merge tags, no HTML) are checked here rather than first at
    // confirm.
    previewableContentOf(fieldsContent({ ...input, ...fields }))
    return {
      goal: input.goal,
      layout: input.layout,
      theme: input.theme,
      subject: input.subject,
      body: input.body,
      ...fields,
      content: Prisma.DbNull,
      paidForBy: scope.paidForBy,
    }
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

  private toView(
    row: DraftRow,
    estimate: EmailSend['estimate'],
    deliveryCounts: EmailDeliveryCounts | null = null,
  ): EmailSend {
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
      voterFileFilterId: row.outreach.voterFileFilterId,
      recipientCount: row._count.recipients,
      recipientCap: row.recipientCap,
      priceCents:
        row.recipientCap === null ? null : emailPriceCents(row.recipientCap),
      sentCount: row.sentCount,
      pauseReason: row.pauseReason,
      stopping: row.stoppingAt !== null,
      cardDeclined:
        row.outreach.paymentHold?.state === OutreachHoldState.hold_failed,
      estimate,
      deliveryCounts,
      content: emailContentOf(row),
    }
  }
}
