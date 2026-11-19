import { Injectable } from '@nestjs/common'
import { AnalyticsService } from '@/analytics/analytics.service'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { APP_ROOT } from 'src/shared/util/appEnvironment.util'
import { EVENTS } from 'src/vendors/segment/segment.types'

export type PaymentHoldEvent =
  | 'hold_failed'
  | 'reminder'
  | 'canceled'
  | 'receipt'

const EVENT_NAMES: Record<PaymentHoldEvent, string> = {
  hold_failed: EVENTS.OutreachPayment.HoldFailed,
  reminder: EVENTS.OutreachPayment.Reminder,
  canceled: EVENTS.OutreachPayment.Canceled,
  receipt: EVENTS.OutreachPayment.Receipt,
}

const toDollars = (cents: number | null): string | undefined =>
  cents == null ? undefined : (cents / 100).toFixed(2)

// The payment emails come from HubSpot workflows keyed on these events. Every
// call is best-effort and made only from the transition that won: the money
// operation has already committed, so a Segment failure must not undo it.
// The deterministic messageId makes a replay produce one email.
@Injectable()
export class PaymentHoldEventsService extends createPrismaBase(
  MODELS.OutreachPaymentHold,
) {
  constructor(private readonly analytics: AnalyticsService) {
    super()
  }

  async emit(
    event: PaymentHoldEvent,
    outreachId: number,
    { day }: { day?: Date } = {},
  ): Promise<void> {
    try {
      const row = await this.model.findUnique({
        where: { outreachId },
        select: {
          channel: true,
          estimateCents: true,
          authorizedCents: true,
          capturedCents: true,
          declineCode: true,
          outreach: {
            select: {
              name: true,
              date: true,
              campaignId: true,
              organizationSlug: true,
              campaign: { select: { organizationSlug: true } },
              email: { select: { sentCount: true } },
            },
          },
        },
      })
      if (!row) return

      const { outreach } = row
      const organizationSlug =
        outreach.organizationSlug ?? outreach.campaign?.organizationSlug
      const organization = organizationSlug
        ? await this.client.organization.findUnique({
            where: { slug: organizationSlug },
            select: { ownerId: true },
          })
        : null
      if (!organization) {
        this.logger.warn(
          { outreachId, event },
          'No owner to send the payment hold event to',
        )
        return
      }

      const mode = outreach.campaignId ? 'win' : 'serve'
      const properties = {
        outreachId,
        channel: row.channel,
        mode,
        sendName: outreach.name ?? undefined,
        sendDate: outreach.date?.toISOString(),
        link: `${APP_ROOT}/dashboard/${
          mode === 'win' ? 'outreach' : 'constituent-outreach'
        }`,
        estimateCents: row.estimateCents,
        estimateDollars: toDollars(row.estimateCents),
        ...(event === 'hold_failed'
          ? { declineCode: row.declineCode ?? undefined }
          : {}),
        ...(event === 'receipt'
          ? {
              capturedCents: row.capturedCents ?? undefined,
              capturedDollars: toDollars(row.capturedCents),
              recipientsSent: outreach.email?.sentCount,
            }
          : {}),
      }
      const messageId =
        event === 'reminder'
          ? `${outreachId}:reminder:${(day ?? new Date()).toISOString().slice(0, 10)}`
          : `${outreachId}:${event}`

      await this.analytics.track(
        organization.ownerId,
        EVENT_NAMES[event],
        properties,
        undefined,
        messageId,
      )
    } catch (err) {
      this.logger.error(
        { err, outreachId, event },
        'Payment hold event emit failed',
      )
    }
  }
}
