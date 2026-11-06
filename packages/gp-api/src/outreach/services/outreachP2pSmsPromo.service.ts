import { Injectable } from '@nestjs/common'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { StripeService } from 'src/vendors/stripe/services/stripe.service'

// Hands a Stripe promotion code back when a Win p2p SMS send that redeemed it
// at checkout is unwound before it bills (cancel, deny, void or refund). Stripe
// counts the redemption at checkout and a single-use code then goes inactive,
// so without this a candidate who cancels loses a one-time code for nothing.
// Shared by every release terminal, next to the free-texts offer restore.
//
// Idempotent: the `promoRestoredAt` claim is taken before the Stripe call so a
// retried or racing unwind mints at most one replacement; a Stripe failure
// releases the claim so a later unwind can try again.
@Injectable()
export class OutreachP2pSmsPromoService extends createPrismaBase(
  MODELS.OutreachP2pSms,
) {
  constructor(private readonly stripe: StripeService) {
    super()
  }

  // True when a replacement code was minted, false when there was nothing to
  // hand back (no code on the send, already restored, or the code is still
  // usable or expired).
  async restore(outreachId: number): Promise<boolean> {
    const sms = await this.model.findUnique({
      where: { outreachId },
      select: { promotionCodeId: true, promoRestoredAt: true },
    })
    if (!sms?.promotionCodeId || sms.promoRestoredAt) return false

    const claim = await this.model.updateMany({
      where: { outreachId, promoRestoredAt: null },
      data: { promoRestoredAt: new Date() },
    })
    if (claim.count === 0) return false

    try {
      const replacement = await this.stripe.regeneratePromotionCode(
        sms.promotionCodeId,
      )
      return replacement !== null
    } catch (err) {
      await this.model.updateMany({
        where: { outreachId },
        data: { promoRestoredAt: null },
      })
      throw err
    }
  }
}
