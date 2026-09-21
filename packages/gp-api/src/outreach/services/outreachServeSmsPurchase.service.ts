import { BadRequestException, Injectable } from '@nestjs/common'
import { z } from 'zod'
import { OutreachStatus, OutreachType } from 'src/generated/prisma'
import { PurchaseHandler } from 'src/payments/purchase.types'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { calcTextAmountInCents } from 'src/shared/util/textPricing.util'
import { QueueProducerService } from 'src/queue/producer/queueProducer.service'
import { MessageGroup, QueueType } from 'src/queue/queue.types'

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

// What rides in the Stripe checkout session. Deliberately just two ids.
//
// Draft-first is required here, not preferred: a Stripe metadata VALUE caps at
// 500 characters and `SMS_COMPOSED_MAX_LENGTH` is 1000, so the poll pattern of
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
})

type ServeSmsPurchaseMetadata = z.infer<typeof ServeSmsPurchaseMetadataSchema>

/** The first send of an outreach. Expansions (polls only) increment it. */
const INITIAL_SEND_SEQ = 1

@Injectable()
export class OutreachServeSmsPurchaseHandlerService
  extends createPrismaBase(MODELS.Outreach)
  implements PurchaseHandler<unknown>
{
  constructor(private readonly queueProducer: QueueProducerService) {
    super()
  }

  /**
   * Both the checkout-create path and the free-purchase path call this before
   * pricing. A non-`pending_payment` row is refused outright, which is what
   * stops a second checkout session being minted for a send that has already
   * been paid for.
   */
  async validatePurchase(rawMetadata: unknown): Promise<void> {
    await this.loadPayableDraft(this.parseMetadata(rawMetadata))
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
    const draft = await this.loadPayableDraft(this.parseMetadata(rawMetadata))
    return calcTextAmountInCents(draft.textCount)
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
    const { outreachId, organizationSlug } = this.parseMetadata(rawMetadata)

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
        outreachType: OutreachType.text,
      },
      select: { textCount: true },
    })

    if (!row) {
      // Permanent: a client-chosen outreachId that names nothing in this org
      // names nothing on every redelivery either.
      throw new BadRequestException(
        `Serve SMS outreach ${outreachId} not found for this organization`,
      )
    }

    const claimed = await this.model.updateMany({
      where: {
        id: outreachId,
        organizationSlug,
        campaignId: null,
        outreachType: OutreachType.text,
        status: OutreachStatus.pending_payment,
      },
      data: {
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
      },
    })

    if (claimed.count === 0) {
      await this.confirmClaimed(outreachId, organizationSlug)
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
      // with no session id would read as an unpaid draft.
      await this.model.updateMany({
        where: {
          id: outreachId,
          organizationSlug,
          status: OutreachStatus.pending,
        },
        data: { status: OutreachStatus.pending_payment },
      })
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
        outreachType: OutreachType.text,
      },
      select: { status: true, textCount: true },
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

    if (draft.textCount === null || draft.textCount < 1) {
      // No server-derived recipient count means there is nothing to bill
      // against. Never fall back to a client-supplied number.
      throw new BadRequestException(
        `Serve SMS draft ${outreachId} has no server-derived recipient count`,
      )
    }

    return { textCount: draft.textCount }
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
  ): Promise<void> {
    const row = await this.model.findFirst({
      where: { id: outreachId, organizationSlug, campaignId: null },
      select: { status: true },
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
