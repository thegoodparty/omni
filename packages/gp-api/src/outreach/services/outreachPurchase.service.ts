import { BadRequestException, Injectable } from '@nestjs/common'
import { CampaignsService } from 'src/campaigns/services/campaigns.service'
import { PurchaseHandler } from 'src/payments/purchase.types'
import { FREE_TEXTS_OFFER } from 'src/shared/constants/freeTextsOffer'
import { calcTextAmountInCents } from 'src/shared/util/textPricing.util'
import { PeerlyPhoneListCaptureService } from 'src/vendors/peerly/services/peerlyPhoneListCapture.service'
import { PeerlyPhoneListService } from 'src/vendors/peerly/services/peerlyPhoneList.service'
import { OutreachPurchaseMetadata } from '../types/outreach.types'
import { OutreachService } from './outreach.service'
import { PinoLogger } from 'nestjs-pino'

@Injectable()
export class OutreachPurchaseHandlerService implements PurchaseHandler<OutreachPurchaseMetadata> {
  constructor(
    private readonly campaignsService: CampaignsService,
    private readonly outreachService: OutreachService,
    private readonly peerlyPhoneListService: PeerlyPhoneListService,
    private readonly peerlyPhoneListCapture: PeerlyPhoneListCaptureService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(OutreachPurchaseHandlerService.name)
  }

  async validatePurchase({
    contactCount,
  }: OutreachPurchaseMetadata): Promise<void> {
    if (!contactCount) {
      throw new BadRequestException('contactCount is required')
    }
  }

  async calculateAmount({
    contactCount,
    campaignId,
    outreachType,
    phoneListToken,
  }: OutreachPurchaseMetadata): Promise<number> {
    if (outreachType !== 'p2p') {
      return calcTextAmountInCents(contactCount)
    }

    // Every PeerlyPhoneList row is written with a real campaignId
    // (recordUpload requires one), so a p2p purchase with a phoneListToken
    // but no campaignId is a client-supplied contradiction, not a legacy
    // no-campaign case — reject it rather than looking the token up
    // unscoped.
    if (!campaignId) {
      throw new BadRequestException(
        'A campaign is required to bill a p2p purchase',
      )
    }

    const billedContactCount = await this.resolveBilledContactCount(
      phoneListToken,
      campaignId,
      contactCount,
    )

    const hasOffer =
      await this.campaignsService.checkFreeTextsEligibility(campaignId)

    if (hasOffer) {
      const discountedContactCount = Math.max(
        0,
        billedContactCount - FREE_TEXTS_OFFER.COUNT,
      )
      const finalAmount = calcTextAmountInCents(discountedContactCount)

      this.logger.info(
        `Campaign ${campaignId}: applying free texts discount (${billedContactCount} contacts, ${discountedContactCount} billable, amount: ${finalAmount})`,
      )

      return finalAmount
    }

    return calcTextAmountInCents(billedContactCount)
  }

  // p2p purchases must never bill off the client-supplied contactCount — it
  // rides in checkout metadata the client controls. Preference order: Peerly's
  // own leads_loaded for the list (the vendor's count of what actually got
  // uploaded), falling back to the captured recipient rows if Peerly can't be
  // reached. Either source missing entirely means there's nothing to bill
  // against, so this throws before the caller ever calls Stripe.
  //
  // This does a live Peerly fetch on every call, so PurchaseService's
  // free-purchase recheck (a second calculateAmount call before granting a
  // $0 purchase) can see a different leads_loaded than the one that produced
  // the original $0 checkout session, and reject a since-legitimate purchase
  // rather than risk under-billing. That's the same tradeoff
  // DomainsService.calculateAmount already accepts (it re-fetches live
  // vendor pricing on every call) — failing the recheck closed on drift, not
  // trusting a stale amount, is intentional here too.
  private async resolveBilledContactCount(
    phoneListToken: string | undefined,
    campaignId: number,
    clientContactCount: number,
  ): Promise<number> {
    if (!phoneListToken) {
      throw new BadRequestException(
        'A phone list is required to bill a p2p purchase',
      )
    }

    const capturedList = await this.peerlyPhoneListCapture.findFirst({
      where: { token: phoneListToken, campaignId },
    })
    if (!capturedList) {
      throw new BadRequestException('No phone list found for this purchase')
    }

    const peerlyLeadsLoaded =
      await this.fetchLeadsLoadedFromPeerly(phoneListToken)
    const serverContactCount =
      peerlyLeadsLoaded ??
      (await this.peerlyPhoneListCapture.countRecipients(capturedList.id))

    // A Peerly-confirmed 0 (e.g. every contact scrubbed to DNC) is a valid
    // answer and must bill $0, not fail — only reject when neither Peerly
    // nor the captured rows produced any count at all.
    if (peerlyLeadsLoaded === null && !serverContactCount) {
      throw new BadRequestException(
        'No billable contacts found for this purchase',
      )
    }

    if (serverContactCount !== clientContactCount) {
      this.logger.warn(
        { campaignId, phoneListToken, clientContactCount, serverContactCount },
        'p2p contactCount mismatch between client and server; billing the server-derived count',
      )
    }

    return serverContactCount
  }

  // Returns null (rather than throwing) on a genuine fetch failure so the
  // caller can fall back to the captured recipient count. A still-processing
  // list is different: `checkPhoneListStatus` resolves null (not a thrown
  // error) specifically for that case, and falling back there would bill the
  // pre-scrub captured rows before Peerly's DNC scrub has run — an overbill,
  // not a degraded-but-reasonable estimate. Reject instead so the client
  // retries once the list goes active.
  private async fetchLeadsLoadedFromPeerly(
    phoneListToken: string,
  ): Promise<number | null> {
    let status
    try {
      status =
        await this.peerlyPhoneListService.checkPhoneListStatus(phoneListToken)
    } catch (error) {
      this.logger.warn(
        { error, phoneListToken },
        'Failed to fetch leads_loaded from Peerly; falling back to captured recipient count',
      )
      return null
    }

    if (status === null) {
      throw new BadRequestException(
        'Phone list is still being processed by Peerly; try again shortly',
      )
    }

    // `list_id` is Zod-optional, so a successfully-parsed status response can
    // still omit it (not yet assigned, or a Peerly inconsistency). Either way
    // it's not a fetch failure — falling back here would hit the same
    // pre-scrub overbill the null-status check above exists to prevent.
    const listId = status.Data.list_id
    if (!listId) {
      throw new BadRequestException(
        'Phone list has no list_id yet; try again shortly',
      )
    }

    try {
      return (await this.peerlyPhoneListService.getPhoneListDetails(listId))
        .leads_loaded
    } catch (error) {
      this.logger.warn(
        { error, phoneListToken },
        'Failed to fetch leads_loaded from Peerly; falling back to captured recipient count',
      )
      return null
    }
  }

  async calculateDiscount(
    contactCount: number,
    campaignId?: number,
    outreachType?: string,
  ): Promise<number> {
    if (!campaignId || outreachType !== 'p2p') {
      return 0
    }

    const hasOffer =
      await this.campaignsService.checkFreeTextsEligibility(campaignId)

    if (hasOffer) {
      const freeTexts = Math.min(contactCount, FREE_TEXTS_OFFER.COUNT)
      return calcTextAmountInCents(freeTexts)
    }

    return 0
  }

  async executePostPurchase(
    paymentIntentId: string,
    rawMetadata: unknown,
  ): Promise<void> {
    if (
      !rawMetadata ||
      typeof rawMetadata !== 'object' ||
      !('outreachType' in rawMetadata) ||
      !('campaignId' in rawMetadata)
    ) {
      return
    }

    const { outreachType, campaignId: rawCampaignId } = rawMetadata
    const campaignId = rawCampaignId ? Number(rawCampaignId) : undefined

    if (!campaignId || outreachType !== 'p2p') {
      return
    }

    // Stripe metadata values round-trip as strings; Number handles both the
    // free-purchase path (number) and the checkout-session path (string).
    const rawOutreachId =
      'outreachId' in rawMetadata ? rawMetadata.outreachId : undefined
    const outreachId = rawOutreachId ? Number(rawOutreachId) : undefined

    // Finalize before redeeming: a throw here must reach the caller so the
    // idempotency marker is never stamped and Stripe retries the webhook.
    // Sessions without an outreachId predate draft-first — for those the
    // campaign was (or will be) created by the client's own POST /outreach.
    if (outreachId) {
      await this.outreachService.finalizeOutreachPurchase(
        outreachId,
        campaignId,
      )
      this.logger.info(
        `Outreach ${outreachId} finalized after payment ${paymentIntentId}`,
      )
    }

    try {
      const hasOffer =
        await this.campaignsService.checkFreeTextsEligibility(campaignId)
      if (hasOffer) {
        await this.campaignsService.redeemFreeTexts(campaignId)
        this.logger.info(
          `Free texts offer redeemed for campaign ${campaignId} after payment ${paymentIntentId}`,
        )
      }
    } catch (error) {
      this.logger.error(
        { error },
        `Failed to redeem free texts offer for campaign ${campaignId} after payment ${paymentIntentId}:`,
      )
    }
  }
}
