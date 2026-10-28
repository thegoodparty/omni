import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import type { EmailPausedSend } from '@goodparty_org/contracts'
import { max as latestOf, startOfMinute } from 'date-fns'
import { PaymentHoldsService } from '@/paymentHolds/services/paymentHolds.service'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import {
  OutreachEmailPauseReason,
  OutreachHoldState,
  OutreachStatus,
} from '../../generated/prisma'
import { SesService } from './ses.service'

// Staff controls for paused sends. Everything is keyed on the Outreach id,
// like the Win and Serve routes.
@Injectable()
export class OutreachEmailAdminService extends createPrismaBase(
  MODELS.OutreachEmail,
) {
  constructor(
    private readonly ses: SesService,
    private readonly holds: PaymentHoldsService,
  ) {
    super()
  }

  async listPaused(): Promise<{ items: EmailPausedSend[] }> {
    const rows = await this.model.findMany({
      where: {
        pausedAt: { not: null },
        stoppingAt: null,
        outreach: { status: OutreachStatus.in_progress },
      },
      include: {
        sender: true,
        outreach: { select: { id: true, organizationSlug: true } },
      },
      orderBy: { pausedAt: 'asc' },
    })
    const items: EmailPausedSend[] = []
    for (const row of rows) {
      if (!row.pausedAt || !row.pauseReason) continue
      items.push({
        outreachId: row.outreach.id,
        organizationSlug:
          row.outreach.organizationSlug ?? row.sender.organizationSlug,
        senderName: row.sender.displayName,
        subject: row.subject,
        pauseReason: row.pauseReason,
        pausedAt: row.pausedAt.toISOString(),
        resumedAt: row.resumedAt?.toISOString() ?? null,
        sentCount: row.sentCount,
        recipientCap: row.recipientCap,
        metrics: await this.metricsSinceResume(row.id, row.resumedAt),
      })
    }
    return { items }
  }

  // The same window auto-pause reads: from the later of the first email and
  // the last staff resume. Null when CloudWatch can't be read, so the page
  // still lists the send.
  private async metricsSinceResume(
    outreachEmailId: number,
    resumedAt: Date | null,
  ): Promise<EmailPausedSend['metrics']> {
    const first = await this.client.outreachEmailRecipient.aggregate({
      where: { outreachEmailId, sentAt: { not: null } },
      _min: { sentAt: true },
    })
    if (!first._min.sentAt) return null
    const start = startOfMinute(
      resumedAt ? latestOf([first._min.sentAt, resumedAt]) : first._min.sentAt,
    )
    try {
      const m = await this.ses.getSendMetrics(
        outreachEmailId,
        start,
        new Date(),
      )
      return {
        send: m.send,
        bounce: m.bounce,
        complaint: m.complaint,
        bounceRate: m.send > 0 ? m.bounce / m.send : 0,
        complaintRate: m.send > 0 ? m.complaint / m.send : 0,
      }
    } catch (err) {
      this.logger.warn(
        { err, outreachEmailId },
        'Reading SES metrics for a paused send failed',
      )
      return null
    }
  }

  // A tenant pause is SES's own, handled with AWS; clearing ours wouldn't
  // let anything send.
  async resume(outreachId: number): Promise<void> {
    const row = await this.findByOutreachOrThrow(outreachId)
    if (row.pauseReason === OutreachEmailPauseReason.ses_tenant) {
      throw new ConflictException(
        'Amazon SES paused this sender. It has to be resolved with AWS.',
      )
    }
    const resumed = await this.model.updateMany({
      where: {
        id: row.id,
        pausedAt: { not: null },
        stoppingAt: null,
        pauseReason: { not: OutreachEmailPauseReason.ses_tenant },
        outreach: { status: OutreachStatus.in_progress },
      },
      data: { resumedAt: new Date(), pausedAt: null, pauseReason: null },
    })
    if (resumed.count === 0) {
      throw new ConflictException('This send is not paused')
    }
    this.logger.info({ outreachId }, 'Email send resumed by staff')
  }

  // Settle stops the send, drains what is in flight and captures what sent;
  // the settle sweep then closes it out as canceled.
  async cancel(outreachId: number): Promise<void> {
    const row = await this.findByOutreachOrThrow(outreachId)
    const hold = await this.client.outreachPaymentHold.findUnique({
      where: { outreachId },
      select: { state: true },
    })
    if (row.outreach.status !== OutreachStatus.in_progress) {
      throw new ConflictException('This send is not running')
    }
    if (hold && hold.state !== OutreachHoldState.held) {
      throw new ConflictException(
        `This send's payment hold is ${hold.state}; it can't be canceled here`,
      )
    }
    await this.holds.settle({ outreachId })
    this.logger.info({ outreachId }, 'Email send canceled by staff')
  }

  private async findByOutreachOrThrow(outreachId: number) {
    const row = await this.model.findUnique({
      where: { outreachId },
      include: { outreach: { select: { status: true } } },
    })
    if (!row) throw new NotFoundException('Email send not found')
    return row
  }
}
