import { BadRequestException, Injectable } from '@nestjs/common'
import { z } from 'zod'
import { OutreachStatus, OutreachType, Prisma } from 'src/generated/prisma'
import { PurchaseHandler } from 'src/payments/purchase.types'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { calcTextAmountInCents } from 'src/shared/util/textPricing.util'
import { QueueProducerService } from 'src/queue/producer/queueProducer.service'
import { MessageGroup, QueueType } from 'src/queue/queue.types'
import { PriorityStatusService } from 'src/priorities/services/priorityStatus.service'
import { isUndrawnSample } from 'src/priorities/util/roundTwo.util'
import { OutreachReportBackService } from './outreachReportBack.service'
import { StripeService } from 'src/vendors/stripe/services/stripe.service'
import { AnalyticsService } from '@/analytics/analytics.service'
import { SlackService } from 'src/vendors/slack/services/slack.service'
import {
  SlackChannel,
  SlackMessageType,
} from 'src/vendors/slack/slackService.types'
import { trackForOffice } from '@/priorities/util/priorityAnalytics.util'
import { EVENTS } from 'src/vendors/segment/segment.types'

/**
 * The Serve SMS purchase handler: paying for a text send from an elected
 * official to their constituents.
 *
 * Separate from `OutreachPurchaseHandlerService` (`PurchaseType.TEXT`) rather
 * than a branch inside it, because that handler is structurally Win-only: its
 * `calculateAmount` bills off Peerly's `leads_loaded` for a phone list that is
 * always campaign-scoped, and its post-purchase step returns early unless a
 * `campaignId` is present and `outreachType === 'p2p'` before finalizing to
 * Peerly. A Serve row has no campaign, no Peerly identity and no 10DLC
 * registration, so none of that applies. The closer precedent is
 * `PollPurchaseHandlerService`, which is org-scoped the same way.
 *
 * See docs/features/serve-sms.md, "Layer 2: SMS (Serve)" → Create and pay,
 * and "Layer 1: Delivery" → Outbound → Trigger.
 */

// What rides in the Stripe checkout session. Deliberately just ids.
//
// Draft-first is required here, not preferred: a Stripe metadata VALUE caps at
// 500 characters and `SMS_COMPOSED_MAX_LENGTH` is 2000, so the poll pattern of
// carrying the message through checkout metadata cannot work. Everything the
// send needs is already on the row.
//
// `organizationSlug` is NOT client input on either call path: `createCheckout
// Session` merges the `@UseOrganization()`-resolved slug over `dto.metadata`
// (purchase.controller.ts `create-checkout-session`), and on the webhook path
// it comes back off the session Stripe stored at creation time. Every query
// below is scoped by it, so a client-chosen `outreachId` can never reach
// another org's row.
//
// `z.coerce.number()` because Stripe round-trips every metadata value as a
// string: the checkout-create call sees the client's JSON number, the
// post-purchase call sees "123".
const ServeSmsPurchaseMetadataSchema = z.object({
  outreachId: z.coerce.number().int().positive(),
  organizationSlug: z.string().min(1),
  expansionId: z.string().min(1).optional(),
})

type ServeSmsPurchaseMetadata = z.infer<typeof ServeSmsPurchaseMetadataSchema>

/** The first send of an outreach. Expansions (polls only) increment it. */
const INITIAL_SEND_SEQ = 1

const SERVE_OUTREACH_TYPES = [OutreachType.text, OutreachType.poll]

@Injectable()
export class OutreachServeSmsPurchaseHandlerService
  extends createPrismaBase(MODELS.Outreach)
  implements PurchaseHandler<unknown>
{
  constructor(
    private readonly queueProducer: QueueProducerService,
    private readonly priorityStatus: PriorityStatusService,
    private readonly stripe: StripeService,
    private readonly slack: SlackService,
    private readonly analytics: AnalyticsService,
    private readonly reportBack: OutreachReportBackService,
  ) {
    super()
  }

  /**
   * Both the checkout-create path and the free-purchase path call this before
   * pricing. A non-`pending_payment` row is refused outright, which is what
   * stops a second checkout session being minted for a send that has already
   * been paid for.
   */
  async validatePurchase(rawMetadata: unknown): Promise<void> {
    const metadata = this.parseMetadata(rawMetadata)
    if (metadata.expansionId) {
      await this.loadPayableExpansion(metadata)
      return
    }
    await this.loadPayableDraft(metadata)
  }

  /**
   * The billable count is re-derived server-side from the row, never read out
   * of metadata. `textCount` is written by the draft endpoint from the saved
   * list with the opt-out scrub applied (see the Serve SMS create response's
   * `recipientCount`); the client never supplies it, and the create schema
   * refuses a client-sent `pending_payment`.
   *
   * Same price function polls and Win SMS both use, so the three surfaces
   * cannot drift.
   */
  async calculateAmount(rawMetadata: unknown): Promise<number> {
    const metadata = this.parseMetadata(rawMetadata)
    const payable = metadata.expansionId
      ? await this.loadPayableExpansion(metadata)
      : await this.loadPayableDraft(metadata)
    return calcTextAmountInCents(payable.textCount)
  }

  getProductName(): string {
    return 'Constituent text messages'
  }

  /**
   * Post-purchase. Two steps and nothing else: claim the row, then ask the
   * delivery layer to send it.
   *
   * Idempotency, because Stripe redelivers at least once and the browser
   * redirect races the webhook by construction (`completeCheckoutSession`
   * documents its own read-then-write window):
   *
   *  - The claim is a compare-and-swap, mirroring `finalizeOutreachPurchase`:
   *    `updateMany` filtered on `status = pending_payment`. Exactly one caller
   *    can win it.
   *  - A caller that loses the claim does not assume the work happened. It
   *    re-reads the row and decides from its state (`confirmClaimed` below).
   *  - The queue message carries a deterministic deduplication id, so two
   *    callers racing within SQS's dedup window produce one send, not two.
   *  - The delivery consumer is itself idempotent (deterministic CSV key,
   *    `skipDuplicates` recipient capture, CAS `pending → in_progress`), so a
   *    duplicate message outside that window is a no-op rather than a second
   *    charge-worth of texts.
   *
   * Throwing matters as much as succeeding: `completeCheckoutSession` stamps
   * `postPurchaseCompletedAt` only after this returns, so any throw leaves the
   * purchase unmarked and Stripe retries. A `BadRequestException` specifically
   * is treated as a PERMANENT content rejection and acknowledged by
   * `paymentEventsService`, so it is used only where every redelivery would
   * hit the same wall.
   */
  async executePostPurchase(
    sessionId: string,
    rawMetadata: unknown,
  ): Promise<void> {
    const metadata = this.parseMetadata(rawMetadata)
    if (metadata.expansionId) {
      await this.executeExpansionPostPurchase(sessionId, metadata)
      return
    }
    const { outreachId, organizationSlug } = metadata

    // Read before the claim purely to carry `textCount` into it — the claim is
    // a filtered `updateMany` and cannot read the row it writes. Deliberately
    // NOT `loadPayableDraft`: this path must tolerate a row that is no longer
    // `pending_payment` (that is the redelivery case, handled below), whereas
    // the pricing path must refuse one.
    const row = await this.model.findFirst({
      where: {
        id: outreachId,
        organizationSlug,
        campaignId: null,
        outreachType: { in: SERVE_OUTREACH_TYPES },
      },
      select: {
        textCount: true,
        reportBackForOutreachId: true,
        outreachType: true,
        voterFileFilter: { select: { sampleSize: true, sampledAt: true } },
        roundTwo: { select: { id: true, textCount: true, status: true } },
      },
    })

    if (!row) {
      // Permanent: a client-chosen outreachId that names nothing in this org
      // names nothing on every redelivery either.
      throw new BadRequestException(
        `Serve SMS outreach ${outreachId} not found for this organization`,
      )
    }

    const claimData = {
      status: OutreachStatus.pending,
      // What was billed, recorded in the same atomic write as the claim.
      // Equal to textCount — Serve has no free-texts offer, that is a
      // campaign-scoped Win promotion — so the "was discounted" predicate
      // (billableTextCount < textCount) stays false.
      ...(row.textCount === null ? {} : { billableTextCount: row.textCount }),
      // Durable payment link for a later refund. The first argument is a
      // real checkout session id on the paid path and a synthetic
      // `free_confirmed_*` marker on the zero-amount path, so only real
      // sessions are persisted. Written WITH the claim rather than after it:
      // if anything below fails and the status is reverted, the row still
      // shows which payment it holds.
      ...(sessionId.startsWith('cs_')
        ? { stripeCheckoutSessionId: sessionId }
        : {}),
    }
    const claimWhere = {
      id: outreachId,
      organizationSlug,
      campaignId: null,
      outreachType: row.outreachType,
      status: OutreachStatus.pending_payment,
    }
    const claimed = row.reportBackForOutreachId
      ? await this.claimReportBack(
          outreachId,
          organizationSlug,
          row.reportBackForOutreachId,
          claimWhere,
          claimData,
          sessionId,
        )
      : row.roundTwo?.status === OutreachStatus.pending_payment
        ? await this.claimWithFollowUp(
            claimWhere,
            claimData,
            row.roundTwo,
            sessionId,
          )
        : await this.model.updateMany({ where: claimWhere, data: claimData })

    const isPoll = row.outreachType === OutreachType.poll

    if (claimed.count === 0) {
      await this.confirmClaimed(outreachId, organizationSlug, isPoll)
      // A redelivery records it again, which is how a status write that
      // failed after the send was enqueued gets another try.
      if (!isPoll) await this.priorityStatus.recordOutreachSent(outreachId)
      return
    }

    // A paid poll stops at `pending`, which the app renders "In review". The
    // admin approval is what enqueues it, so there is nothing to send here.
    // Only the caller that won the claim reaches this line, which is what
    // keeps a redelivered webhook from posting a second notice.
    if (isPoll) {
      this.logger.info(
        { outreachId, organizationSlug, sessionId },
        'Serve poll claimed after payment; held for review',
      )
      await this.notifyPollAwaitingReview(outreachId, organizationSlug)
      return
    }

    // A priority's round 2 is paid for now and handed off once its list is
    // drawn, close to its send date. The draw enqueues it then, and only
    // then puts the priority's check out.
    if (isUndrawnSample(row.voterFileFilter)) {
      this.logger.info(
        { outreachId, organizationSlug, sessionId },
        'Serve round 2 text claimed after payment; held for its draw',
      )
      return
    }

    try {
      await this.enqueueSend(outreachId)
    } catch (error) {
      // Revert the claim so the row is recoverable rather than sitting
      // `pending` with no send behind it — the same revert
      // `finalizeOutreachPurchase` does when the Peerly submission fails. The
      // guard on `status = pending` means a revert can never clobber a status
      // something else has since moved on. `stripeCheckoutSessionId` is left
      // in place deliberately: the row is paid, and a bare `pending_payment`
      // with no session id would read as an unpaid draft. A follow-up claimed
      // with it goes back too, so it can never send without its first half.
      const revert = {
        where: {
          id: outreachId,
          organizationSlug,
          status: OutreachStatus.pending,
        },
        data: { status: OutreachStatus.pending_payment },
      }
      if (row.roundTwo) {
        await this.client.$transaction([
          this.client.outreach.updateMany(revert),
          this.client.outreach.updateMany({
            where: {
              roundOneOutreachId: outreachId,
              status: OutreachStatus.pending,
            },
            data: { status: OutreachStatus.pending_payment },
          }),
        ])
      } else {
        await this.model.updateMany(revert)
      }
      this.logger.error(
        { error, outreachId, organizationSlug, sessionId },
        'Serve SMS send could not be enqueued after payment; claim reverted',
      )
      // Not a BadRequestException: an SQS failure is transient, so Stripe
      // should redeliver and the retry re-claims from pending_payment.
      throw error
    }

    this.logger.info(
      { outreachId, organizationSlug, sessionId },
      'Serve SMS send claimed and enqueued after payment',
    )
    if (row.reportBackForOutreachId) {
      void this.trackReportBackSent(
        organizationSlug,
        row.reportBackForOutreachId,
      )
    }

    // Paid and scheduled is when a text counts as out. Outside the revert
    // above: the send stands even if this write fails, and the throw makes
    // Stripe redeliver, which lands in the lost-claim branch and records it.
    await this.priorityStatus.recordOutreachSent(outreachId)
  }

  // Only the claim that won reaches this, so a redelivered webhook never
  // counts a report back twice. Telemetry: it never fails the purchase.
  private async trackReportBackSent(
    organizationSlug: string,
    reportBackForOutreachId: number,
  ): Promise<void> {
    try {
      const facts = await this.reportBack.reportBackFacts(
        organizationSlug,
        reportBackForOutreachId,
      )
      if (!facts) return
      await trackForOffice(this.client, this.analytics, { organizationSlug }, [
        [EVENTS.Priorities.ReportBackSent, { ...facts, channel: 'text' }],
      ])
    } catch (err) {
      this.logger.warn({ err, organizationSlug }, 'Report back event failed')
    }
  }

  // A paid expansion stops at `pending` like the poll it belongs to, and the
  // parent poll is never written: its status and approval are the first
  // send's, not this one's.
  private async executeExpansionPostPurchase(
    sessionId: string,
    { outreachId, organizationSlug, expansionId }: ServeSmsPurchaseMetadata,
  ): Promise<void> {
    if (!expansionId) return
    const claimed = await this.client.outreachPollExpansion.updateMany({
      where: {
        id: expansionId,
        outreachId,
        status: OutreachStatus.pending_payment,
        poll: { outreach: this.expansionParentWhere(organizationSlug) },
      },
      data: {
        status: OutreachStatus.pending,
        ...(sessionId.startsWith('cs_')
          ? { stripeCheckoutSessionId: sessionId }
          : {}),
      },
    })

    if (claimed.count === 0) {
      await this.confirmExpansionClaimed(
        outreachId,
        organizationSlug,
        expansionId,
      )
      return
    }

    this.logger.info(
      { outreachId, expansionId, organizationSlug, sessionId },
      'Serve poll expansion claimed after payment; held for review',
    )
    await this.notifyExpansionAwaitingReview(
      outreachId,
      organizationSlug,
      expansionId,
    )
  }

  // Same reasoning as `confirmClaimed`: a lost claim proves nothing, so
  // decide from the row. An expansion has no enqueue to repeat, so every
  // state past `pending_payment` that is not dead means the winner finished.
  private async confirmExpansionClaimed(
    outreachId: number,
    organizationSlug: string,
    expansionId: string,
  ): Promise<void> {
    const row = await this.client.outreachPollExpansion.findFirst({
      where: {
        id: expansionId,
        outreachId,
        poll: { outreach: this.expansionParentWhere(organizationSlug) },
      },
      select: { status: true },
    })

    if (!row) {
      throw new BadRequestException(
        `Poll expansion ${expansionId} not found for this organization`,
      )
    }

    if (row.status === OutreachStatus.pending_payment) {
      throw new Error(
        `Poll expansion ${expansionId} is still pending_payment after a ` +
          'lost claim',
      )
    }

    if (
      row.status === OutreachStatus.canceled ||
      row.status === OutreachStatus.denied
    ) {
      this.logger.error(
        { outreachId, expansionId, organizationSlug, status: row.status },
        'Poll expansion payment completed against a dead expansion; ' +
          'nothing sent',
      )
      throw new BadRequestException(
        `Poll expansion ${expansionId} is ${row.status}; refusing to send`,
      )
    }
  }

  private expansionParentWhere(
    organizationSlug: string,
  ): Prisma.OutreachWhereInput {
    return {
      organizationSlug,
      campaignId: null,
      outreachType: OutreachType.poll,
    }
  }

  private async loadPayableExpansion({
    outreachId,
    organizationSlug,
    expansionId,
  }: ServeSmsPurchaseMetadata): Promise<{ textCount: number }> {
    const expansion = await this.client.outreachPollExpansion.findFirst({
      where: {
        id: expansionId,
        outreachId,
        poll: { outreach: this.expansionParentWhere(organizationSlug) },
      },
      select: { status: true, textCount: true },
    })

    if (!expansion) {
      throw new BadRequestException(
        `No poll expansion ${expansionId} for this organization`,
      )
    }

    if (expansion.status !== OutreachStatus.pending_payment) {
      throw new BadRequestException(
        `Poll expansion ${expansionId} is not awaiting payment ` +
          `(status ${expansion.status})`,
      )
    }

    return { textCount: expansion.textCount }
  }

  private async notifyExpansionAwaitingReview(
    outreachId: number,
    organizationSlug: string,
    expansionId: string,
  ): Promise<void> {
    try {
      const expansion = await this.client.outreachPollExpansion.findUnique({
        where: { id: expansionId },
        select: {
          sendSeq: true,
          textCount: true,
          poll: {
            select: {
              outreach: {
                select: {
                  message: true,
                  organization: {
                    select: {
                      owner: { select: { firstName: true, lastName: true } },
                    },
                  },
                },
              },
            },
          },
        },
      })
      const owner = expansion?.poll.outreach.organization?.owner
      const official = [owner?.firstName, owner?.lastName]
        .filter(Boolean)
        .join(' ')

      await this.slack.message(
        {
          blocks: [
            {
              type: SlackMessageType.HEADER,
              text: {
                type: SlackMessageType.PLAIN_TEXT,
                text: 'Poll expansion awaiting review',
                emoji: true,
              },
            },
            {
              type: SlackMessageType.SECTION,
              text: {
                type: SlackMessageType.MRKDWN,
                text:
                  `*Organization*: ${organizationSlug}` +
                  (official ? ` (${official})` : '') +
                  `\n*Poll*: ${outreachId}, send ${expansion?.sendSeq ?? 'unknown'}` +
                  `\n*Recipients*: ${expansion?.textCount ?? 'unknown'}` +
                  `\n*Message*: ${expansion?.poll.outreach.message ?? 'unknown'}`,
              },
            },
          ],
        },
        SlackChannel.botTevynApi,
      )
    } catch (err) {
      this.logger.error(
        { err, outreachId, expansionId, organizationSlug },
        'Serve poll expansion review notice failed',
      )
    }
  }

  private async notifyPollAwaitingReview(
    outreachId: number,
    organizationSlug: string,
  ): Promise<void> {
    try {
      const poll = await this.model.findUnique({
        where: { id: outreachId },
        select: {
          message: true,
          textCount: true,
          organization: {
            select: {
              slug: true,
              customPositionName: true,
              owner: { select: { id: true, firstName: true, lastName: true } },
            },
          },
        },
      })
      const owner = poll?.organization?.owner
      const official = [owner?.firstName, owner?.lastName]
        .filter(Boolean)
        .join(' ')

      await this.slack.message(
        {
          blocks: [
            {
              type: SlackMessageType.HEADER,
              text: {
                type: SlackMessageType.PLAIN_TEXT,
                text: 'New poll awaiting review',
                emoji: true,
              },
            },
            {
              type: SlackMessageType.SECTION,
              text: {
                type: SlackMessageType.MRKDWN,
                text:
                  `*Organization*: ${organizationSlug}` +
                  (official ? ` (${official})` : '') +
                  `\n*Recipients*: ${poll?.textCount ?? 'unknown'}` +
                  `\n*Message*: ${poll?.message ?? 'unknown'}`,
              },
            },
          ],
        },
        SlackChannel.botTevynApi,
      )

      if (owner) {
        await this.analytics.track(
          owner.id,
          EVENTS.Polls.PollSubmitted,
          { outreachId, recipientCount: poll?.textCount },
          undefined,
          `${EVENTS.Polls.PollSubmitted}-${outreachId}`,
        )
      }
    } catch (err) {
      // The poll is paid and claimed; a missed notice must not make Stripe
      // redeliver, because the redelivery loses the claim and would not
      // post it anyway.
      this.logger.error(
        { err, outreachId, organizationSlug },
        'Serve poll review notice failed',
      )
    }
  }

  // Two drafts of one report back can both pass checkout when they are paid
  // at once. The claim is serialized per send it answers, and only the first
  // goes out: the other is canceled before anything is sent, holding its
  // checkout session so staff can refund it from the console's Canceled tab.
  private async claimReportBack(
    outreachId: number,
    organizationSlug: string,
    reportBackForOutreachId: number,
    where: Prisma.OutreachWhereInput,
    data: Prisma.OutreachUpdateManyMutationInput,
    sessionId: string,
  ): Promise<{ count: number }> {
    const priorityId = await this.reportBack.priorityOf(
      organizationSlug,
      reportBackForOutreachId,
    )
    const outcome = await this.client.$transaction(async (tx) => {
      // One report back goes out per priority, so the lock is the priority's.
      const lockKey = `report_back:${priorityId ?? reportBackForOutreachId}`
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`
      const sibling = priorityId
        ? await this.reportBack.sentReportBack(
            organizationSlug,
            priorityId,
            outreachId,
          )
        : null
      if (!sibling) {
        return {
          claimed: await tx.outreach.updateMany({ where, data }),
          duplicateOf: null,
        }
      }
      await tx.outreach.updateMany({
        where,
        data: {
          ...data,
          status: OutreachStatus.canceled,
          canceledAt: new Date(),
          canceledBy: 'report_back_already_sent',
        },
      })
      return { claimed: null, duplicateOf: sibling.outreachId }
    })
    if (outcome.claimed) return outcome.claimed
    this.logger.error(
      { outreachId, duplicateOf: outcome.duplicateOf, sessionId },
      'Serve report back paid after another went out; canceled unsent',
    )
    await this.refundDuplicate(outreachId, sessionId)
    throw new BadRequestException(
      `A report back on outreach ${reportBackForOutreachId} already went out`,
    )
  }

  // A priority text's follow-up is paid for in its first send's checkout,
  // so both are claimed in one write: a paid first send never leaves its
  // follow-up unpaid, and the follow-up then waits on its draw like any
  // round 2. Each records what it billed.
  private claimWithFollowUp(
    claimWhere: Prisma.OutreachWhereInput,
    claimData: Prisma.OutreachUpdateManyMutationInput,
    followUp: { id: number; textCount: number | null },
    sessionId: string,
  ): Promise<{ count: number }> {
    return this.client.$transaction(async (tx) => {
      const claimed = await tx.outreach.updateMany({
        where: claimWhere,
        data: claimData,
      })
      if (claimed.count === 0) return claimed
      await tx.outreach.updateMany({
        where: { id: followUp.id, status: OutreachStatus.pending_payment },
        data: {
          status: OutreachStatus.pending,
          ...(followUp.textCount === null
            ? {}
            : { billableTextCount: followUp.textCount }),
          ...(sessionId.startsWith('cs_')
            ? { stripeCheckoutSessionId: sessionId }
            : {}),
        },
      })
      return claimed
    })
  }

  // The same refund a cancel-before-send issues, keyed on the row so a
  // redelivered completion can never refund twice. A failed refund leaves
  // the row canceled holding its session, which the console lists for staff.
  private async refundDuplicate(
    outreachId: number,
    sessionId: string,
  ): Promise<void> {
    if (!sessionId.startsWith('cs_')) return
    try {
      const session = await this.stripe.retrieveCheckoutSession(sessionId)
      const paymentIntentId =
        typeof session.payment_intent === 'string'
          ? session.payment_intent
          : session.payment_intent?.id
      if (paymentIntentId) {
        // Keyed on the payment: outreach ids repeat across PR previews,
        // which share one Stripe account.
        await this.stripe.refundPaymentIntent(
          paymentIntentId,
          `outreach-cancel-${paymentIntentId}`,
        )
      }
    } catch (err) {
      this.logger.error(
        { err, outreachId, sessionId },
        'Refund failed for a duplicate Serve report back; refund it by hand',
      )
    }
  }

  private parseMetadata(rawMetadata: unknown): ServeSmsPurchaseMetadata {
    const result = ServeSmsPurchaseMetadataSchema.safeParse(rawMetadata)
    if (!result.success) {
      // Permanent: the metadata is frozen on the session, so redelivering the
      // same bad payload forever buys nothing.
      throw new BadRequestException(
        `Invalid Serve SMS purchase metadata: ${result.error.message}`,
      )
    }
    return result.data
  }

  /**
   * The one read the pricing path is allowed to trust. Scoped by the
   * server-resolved org and pinned to a Serve text draft (`campaignId: null`),
   * so a Win p2p row can never be priced through here and another org's row is
   * simply not found.
   */
  private async loadPayableDraft({
    outreachId,
    organizationSlug,
  }: ServeSmsPurchaseMetadata): Promise<{ textCount: number }> {
    const draft = await this.model.findFirst({
      where: {
        id: outreachId,
        organizationSlug,
        campaignId: null,
        outreachType: { in: SERVE_OUTREACH_TYPES },
      },
      select: {
        id: true,
        status: true,
        textCount: true,
        reportBackForOutreachId: true,
        roundTwo: { select: { status: true, textCount: true } },
      },
    })

    if (!draft) {
      throw new BadRequestException(
        `No Serve SMS draft ${outreachId} for this organization`,
      )
    }

    if (draft.status !== OutreachStatus.pending_payment) {
      // Refusing here is what stops a second checkout session being created
      // for a send that is already paid for: the first payment moved the row
      // off pending_payment.
      throw new BadRequestException(
        `Serve SMS draft ${outreachId} is not awaiting payment (status ${draft.status})`,
      )
    }

    // Two drafts of one report back can both reach checkout (two tabs, or
    // Back and forward again); only the first paid may go out.
    if (draft.reportBackForOutreachId) {
      const priorityId = await this.reportBack.priorityOf(
        organizationSlug,
        draft.reportBackForOutreachId,
      )
      const paid = priorityId
        ? await this.reportBack.sentReportBack(
            organizationSlug,
            priorityId,
            draft.id,
          )
        : null
      if (paid) {
        throw new BadRequestException(
          `A report back on outreach ${draft.reportBackForOutreachId} already went out`,
        )
      }
    }

    if (draft.textCount === null || draft.textCount < 1) {
      // No server-derived recipient count means there is nothing to bill
      // against. Never fall back to a client-supplied number.
      throw new BadRequestException(
        `Serve SMS draft ${outreachId} has no server-derived recipient count`,
      )
    }

    // A priority text's follow-up is bought with it: one checkout, both
    // counts.
    const followUp =
      draft.roundTwo?.status === OutreachStatus.pending_payment
        ? (draft.roundTwo.textCount ?? 0)
        : 0
    return { textCount: draft.textCount + followUp }
  }

  /**
   * A lost claim does NOT prove the work happened — the same reasoning
   * `confirmFinalized` applies on the Win side. Decide from the row:
   *
   *  - Missing or not this org's: permanent. A client-chosen `outreachId`
   *    that names nothing is identical on every redelivery.
   *  - Still `pending_payment`: the winner reverted (or a cancel raced in).
   *    Transient — throw so Stripe redelivers and the retry re-claims.
   *  - `canceled` / `denied`: terminal. Money was captured against a dead
   *    draft; no redelivery can fix that, so acknowledge loudly rather than
   *    retrying for days. Refunding is a human decision.
   *  - `pending`: claimed, but nothing proves the enqueue landed (unlike
   *    Win's `projectId` there is no stamp for it). Re-enqueue. The consumer
   *    is idempotent and the deduplication id collapses a near-simultaneous
   *    duplicate, so this is strictly safer than assuming a send exists.
   *  - Anything further along (`in_progress`, `completed`, ...): the handoff
   *    already happened. Return without enqueuing.
   */
  private async confirmClaimed(
    outreachId: number,
    organizationSlug: string,
    isPoll: boolean,
  ): Promise<void> {
    const row = await this.model.findFirst({
      where: { id: outreachId, organizationSlug, campaignId: null },
      select: {
        status: true,
        voterFileFilter: { select: { sampleSize: true, sampledAt: true } },
      },
    })

    if (!row) {
      throw new BadRequestException(
        `Serve SMS outreach ${outreachId} not found for this organization`,
      )
    }

    if (row.status === OutreachStatus.pending_payment) {
      throw new Error(
        `Serve SMS outreach ${outreachId} is still pending_payment after a lost claim`,
      )
    }

    if (
      row.status === OutreachStatus.canceled ||
      row.status === OutreachStatus.denied
    ) {
      this.logger.error(
        { outreachId, organizationSlug, status: row.status },
        'Serve SMS payment completed against a canceled draft; nothing sent',
      )
      throw new BadRequestException(
        `Serve SMS outreach ${outreachId} is ${row.status}; refusing to send`,
      )
    }

    if (row.status === OutreachStatus.pending && isPoll) {
      // Held for review on purpose: the approval enqueues it, not payment.
      return
    }

    if (
      row.status === OutreachStatus.pending &&
      isUndrawnSample(row.voterFileFilter)
    ) {
      // A round 2 text waiting on its draw, which enqueues it.
      return
    }

    if (row.status === OutreachStatus.pending) {
      this.logger.info(
        { outreachId, organizationSlug },
        'Serve SMS claim already held by a concurrent completion; re-enqueuing',
      )
      await this.enqueueSend(outreachId)
      return
    }

    this.logger.info(
      { outreachId, organizationSlug, status: row.status },
      'Serve SMS send already handed off; skipping duplicate fulfillment',
    )
  }

  /**
   * Per-outreach FIFO message group, so two deliveries for the same send
   * serialize instead of racing each other through the delivery layer.
   *
   * `throwOnError` because the producer swallows failures by default, and a
   * swallowed failure here would leave a paid row claimed with no send behind
   * it. The deduplication id is deterministic over (outreach, sendSeq): inside
   * SQS's dedup window — which is exactly the window the webhook/redirect race
   * lives in — a duplicate collapses to one message, while a later Stripe
   * redelivery is allowed through so a genuinely lost message can still be
   * recovered.
   */
  private async enqueueSend(outreachId: number): Promise<void> {
    await this.queueProducer.sendMessage(
      {
        type: QueueType.OUTREACH_TEXT_SEND,
        data: { outreachId, sendSeq: INITIAL_SEND_SEQ },
      },
      `${MessageGroup.outreachTextSend}-${outreachId}`,
      {
        throwOnError: true,
        deduplicationId: `${QueueType.OUTREACH_TEXT_SEND}-${outreachId}-${INITIAL_SEND_SEQ}`,
      },
    )
  }
}
