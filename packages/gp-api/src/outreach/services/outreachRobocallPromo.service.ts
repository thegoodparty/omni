import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import type { RobocallPromoStateResponse } from '@goodparty_org/contracts'
import type Stripe from 'stripe'
import {
  Campaign,
  OutreachType,
  RobocallSettleState,
} from '../../generated/prisma'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { calcRobocallTotalInCents } from 'src/shared/util/robocallPricing.util'
import {
  robocallDiscountInCents,
  robocallPromoState,
} from 'src/shared/util/robocallPromo.util'
import { StripeService } from 'src/vendors/stripe/services/stripe.service'

// A code the authorize path has re-validated against the live estimate: what
// to fold into the hold and what to deactivate in Stripe once money commits.
export type ResolvedRobocallPromo = {
  promotionCodeId: string
  promoCode: string
  discountInCents: number
  coversTotal: boolean
}

// The states a draft may still change its promo in: before any hold exists.
const PROMO_EDITABLE_STATES: RobocallSettleState[] = [
  RobocallSettleState.pending_payment,
  RobocallSettleState.hold_failed,
]

// Reward promotion codes on the robocall pay step. Stripe applies a code only
// to a Checkout Session or invoice, and the robocall pays through a manual-
// capture hold Stripe cannot discount, so this service does what Checkout
// would: validate the code with Stripe, price the discount into the hold, and
// deactivate the code once it is spent. Applying a code only REMEMBERS it on
// the pending draft; consumption happens where money commits (the hold service),
// so a candidate who types a code and leaves keeps it.
@Injectable()
export class OutreachRobocallPromoService extends createPrismaBase(
  MODELS.OutreachRobocall,
) {
  constructor(private readonly stripe: StripeService) {
    super()
  }

  async apply(
    campaign: Campaign,
    outreachId: number,
    code: string,
  ): Promise<RobocallPromoStateResponse> {
    const draft = await this.findEditableDraft(campaign, outreachId)
    const promo = await this.lookup(code)
    await this.assertUnredeemed(promo.id, outreachId)

    const coupon = this.couponOf(promo)
    const minimum = promo.restrictions.minimum_amount
    if (minimum != null && draft.amountInCents < minimum) {
      throw new BadRequestException(
        'This promo code needs a larger order than this robocall',
      )
    }
    const discount = robocallDiscountInCents(coupon, draft.amountInCents)
    if (discount <= 0) {
      throw new BadRequestException("That promo code doesn't apply here")
    }

    await this.model.updateMany({
      where: { outreachId, settleState: { in: PROMO_EDITABLE_STATES } },
      data: {
        promotionCodeId: promo.id,
        promoCode: promo.code,
        promoDiscountInCents: discount,
      },
    })
    return robocallPromoState(
      { promoCode: promo.code, promoDiscountInCents: discount },
      draft.amountInCents,
    )
  }

  async remove(
    campaign: Campaign,
    outreachId: number,
  ): Promise<RobocallPromoStateResponse> {
    const draft = await this.findEditableDraft(campaign, outreachId)
    await this.model.updateMany({
      where: { outreachId, settleState: { in: PROMO_EDITABLE_STATES } },
      data: {
        promotionCodeId: null,
        promoCode: null,
        promoDiscountInCents: null,
      },
    })
    return robocallPromoState(
      { promoCode: null, promoDiscountInCents: 0 },
      draft.amountInCents,
    )
  }

  // Called by the hold service with the estimate it is about to authorize. The
  // code is looked up again so a code spent elsewhere since it was applied is
  // refused before any money moves, and the discount is re-priced against the
  // live estimate (the audience can change between draft and authorize).
  async resolveForAuthorize(
    draft: {
      outreachId: number
      promotionCodeId: string | null
      promoCode: string | null
    },
    estimateInCents: number,
  ): Promise<ResolvedRobocallPromo | null> {
    if (!draft.promotionCodeId || !draft.promoCode) return null
    const promo = await this.stripe.findActivePromotionCode(draft.promoCode)
    if (!promo || promo.id !== draft.promotionCodeId) {
      throw new BadRequestException(
        'The promo code on this robocall is no longer valid',
      )
    }
    await this.assertUnredeemed(promo.id, draft.outreachId)
    const discount = robocallDiscountInCents(
      this.couponOf(promo),
      estimateInCents,
    )
    const state = robocallPromoState(
      { promoCode: promo.code, promoDiscountInCents: discount },
      estimateInCents,
    )
    return {
      promotionCodeId: promo.id,
      promoCode: promo.code,
      discountInCents: state.promoDiscountInCents,
      coversTotal: state.coversTotal,
    }
  }

  // Once the hold committed (or the covered run was scheduled) the code is
  // spent: switch it off in Stripe so it cannot be redeemed again anywhere.
  // Best-effort — the redemption stamp on the row is the second guard.
  async consume(promotionCodeId: string): Promise<void> {
    await this.stripe.setPromotionCodeActive(promotionCodeId, false)
  }

  // A run unwound before any call was placed hands the reward back: clear the
  // redemption stamp (so the code passes assertUnredeemed again) and switch it
  // back on in Stripe. The code fields stay on the row for the audit trail.
  async restore(outreachId: number): Promise<void> {
    const row = await this.findFirst({
      where: { outreachId, promoRedeemedAt: { not: null } },
      select: { promotionCodeId: true },
    })
    if (!row?.promotionCodeId) return
    await this.model.updateMany({
      where: { outreachId },
      data: { promoRedeemedAt: null, promoCoversTotal: false },
    })
    await this.stripe.setPromotionCodeActive(row.promotionCodeId, true)
  }

  private async findEditableDraft(campaign: Campaign, outreachId: number) {
    const draft = await this.findFirst({
      where: {
        outreachId,
        outreach: {
          campaignId: campaign.id,
          outreachType: OutreachType.robocall,
        },
      },
    })
    if (!draft) {
      throw new NotFoundException('Robocall draft not found for this campaign')
    }
    if (!PROMO_EDITABLE_STATES.includes(draft.settleState)) {
      throw new BadRequestException(
        'This robocall is already paid for; the promo code cannot change',
      )
    }
    // Recompute rather than trust the stored column, as findExistingDraft does:
    // a draft created before the number fee shipped has a stale, fee-less
    // amountInCents, and the authorize path prices against the live estimate.
    // A saved draft (status `draft`) has not been priced yet: the resume's
    // conversion writes its count before the pay step can offer a code.
    if (draft.billableCount === null) {
      throw new BadRequestException('This robocall has not been priced yet')
    }
    return {
      ...draft,
      amountInCents: calcRobocallTotalInCents(draft.billableCount),
    }
  }

  private async lookup(code: string): Promise<Stripe.PromotionCode> {
    const promo = await this.stripe.findActivePromotionCode(code.trim())
    if (!promo || !this.couponOf(promo).valid) {
      throw new BadRequestException("That promo code isn't valid")
    }
    return promo
  }

  // Stripe leaves the coupon a string id unless expanded; the lookup expands it.
  private couponOf(promo: Stripe.PromotionCode): Stripe.Coupon {
    const coupon = promo.promotion.coupon
    if (typeof coupon !== 'object' || coupon === null) {
      throw new BadRequestException("That promo code isn't valid")
    }
    return coupon
  }

  // Stripe does not count a redemption we apply outside Checkout, so our own
  // rows are the record. Another robocall that already spent this code refuses
  // it; the same draft re-applying is fine. This is a read, so it is only the
  // early, friendly error: two authorizes racing on different drafts both pass
  // it. The partial unique index on a redeemed promotion_code_id (see the
  // migration) is the atomic guard — the second commit fails on it.
  private async assertUnredeemed(
    promotionCodeId: string,
    outreachId: number,
  ): Promise<void> {
    const spent = await this.findFirst({
      where: {
        promotionCodeId,
        promoRedeemedAt: { not: null },
        outreachId: { not: outreachId },
      },
      select: { outreachId: true },
    })
    if (spent) {
      throw new BadRequestException('This promo code has already been used')
    }
  }
}
