import { BadRequestException, Injectable } from '@nestjs/common'
import { isAxiosError } from 'axios'
import { CampaignsService } from 'src/campaigns/services/campaigns.service'
import { ContactsService } from 'src/contacts/services/contacts.service'
import { MAX_AUDIENCE_RECIPIENTS } from 'src/contacts/utils/audienceResolution.util'
import { OrganizationsService } from 'src/organizations/services/organizations.service'
import { PurchaseHandler } from 'src/payments/purchase.types'
import { FREE_TEXTS_OFFER } from 'src/shared/constants/freeTextsOffer'
import { calcTextAmountInCents } from 'src/shared/util/textPricing.util'
import { PeerlyPhoneListCaptureService } from 'src/vendors/peerly/services/peerlyPhoneListCapture.service'
import { PeerlyPhoneListService } from 'src/vendors/peerly/services/peerlyPhoneList.service'
import {
  isWinSmsHoldBillingEnabled,
  WIN_SMS_HOLD_MIN_CENTS,
} from 'src/shared/util/winSmsHold.util'
import { PhoneListBuildStatus } from '../../generated/prisma'
import { OutreachPurchaseMetadata } from '../types/outreach.types'
import { OutreachService } from './outreach.service'
import { OutreachP2pSmsHoldService } from './outreachP2pSmsHold.service'
import { OutreachP2pSmsCaptureService } from './outreachP2pSmsCapture.service'
import { PinoLogger } from 'nestjs-pino'

@Injectable()
export class OutreachPurchaseHandlerService implements PurchaseHandler<OutreachPurchaseMetadata> {
  constructor(
    private readonly campaignsService: CampaignsService,
    private readonly outreachService: OutreachService,
    private readonly peerlyPhoneListService: PeerlyPhoneListService,
    private readonly peerlyPhoneListCapture: PeerlyPhoneListCaptureService,
    private readonly contactsService: ContactsService,
    private readonly organizationsService: OrganizationsService,
    private readonly p2pSmsHold: OutreachP2pSmsHoldService,
    private readonly p2pSmsCapture: OutreachP2pSmsCaptureService,
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
    // (createQueuedBuild requires one, at accept time — before recordUpload
    // ever runs), so a p2p purchase with a phoneListToken but no campaignId
    // is a client-supplied contradiction, not a legacy no-campaign case —
    // reject it rather than looking the token up unscoped.
    if (!campaignId) {
      throw new BadRequestException(
        'A campaign is required to bill a p2p purchase',
      )
    }

    // Win SMS hold billing: the checkout places an authorization HOLD on the
    // UNDISCOUNTED amount, so a later capture (slice C1) can apply the
    // free-texts discount and never exceed the hold even if the campaign's
    // eligibility changes between hold and capture. Sub-50c is below Stripe's
    // authorization floor, so it is forgiven (amount 0 -> the free path, no
    // hold placed) rather than blocking checkout for a tiny campaign.
    //
    // PAY-BEFORE-BUILD (slice D2a): when the Peerly list is NOT yet built there
    // is no final leads_loaded to bill against, so the hold is sourced from the
    // pre-pay match-count estimate (getListDetail reachability.sms) — a true
    // upper bound of the eventual leads_loaded — instead. Once the build is
    // ready the current leads_loaded basis (resolveBilledContactCount) is used
    // unchanged. Capture (C1) clamps to the authorized hold, so an estimate
    // >= leads_loaded means capture is never clamped down.
    if (isWinSmsHoldBillingEnabled()) {
      return this.resolveWinSmsHoldAmount(
        phoneListToken,
        campaignId,
        contactCount,
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

  // The Win SMS hold amount (cents) for a p2p checkout: UNDISCOUNTED so a later
  // capture (slice C1) can apply the free-texts discount and still never exceed
  // the hold. One build-row lookup drives both branches:
  //  - READY build: bill the current server-derived leads_loaded (the unchanged
  //    B1 basis), undiscounted; sub-50c forgiven to 0 (below Stripe's floor).
  //  - PRE-BUILD (slice D2a): no final leads_loaded yet, so source the hold from
  //    the pre-pay match-count estimate — see resolvePreBuildHoldAmount.
  private async resolveWinSmsHoldAmount(
    phoneListToken: string | undefined,
    campaignId: number,
    clientContactCount: number,
  ): Promise<number> {
    if (!phoneListToken) {
      throw new BadRequestException(
        'A phone list is required to bill a p2p purchase',
      )
    }
    const build = await this.peerlyPhoneListCapture.findFirst({
      where: { token: phoneListToken, campaignId },
    })
    if (!build) {
      throw new BadRequestException('No phone list found for this purchase')
    }

    // A FAILED build never reaches `ready`, so no build-ready edge would ever
    // finalize or capture a hold placed on it — the hold would strand (reserved,
    // shows Scheduled, silently released with no send). Refuse checkout; the list
    // must be rebuilt first. Only an in-progress build (queued/building/
    // processing) takes the pre-build estimate path.
    if (build.buildStatus === PhoneListBuildStatus.failed) {
      throw new BadRequestException(
        'This phone list failed to build — rebuild it before paying',
      )
    }

    if (build.buildStatus !== PhoneListBuildStatus.ready) {
      return this.resolvePreBuildHoldAmount(build)
    }

    const builtContactCount = await this.billedCountFromCapturedList(
      build,
      clientContactCount,
      campaignId,
      phoneListToken,
    )
    const undiscounted = calcTextAmountInCents(builtContactCount)
    return undiscounted < WIN_SMS_HOLD_MIN_CENTS ? 0 : undiscounted
  }

  // The pre-build hold amount: the has-cell match count of the build's saved
  // voter list (getListDetail reachability.sms) priced undiscounted.
  //
  // UPPER-BOUND PROOF (money-safety): reachability.sms is the same pre-pay figure
  // the webapp shows, and is provably >= the eventual leads_loaded, because the
  // build is strictly SUBTRACTIVE from it: it resolves the same filter with
  // hasCellPhone forced (the reachability.sms set), then removes rows with an
  // incomplete address, duplicate phones and org opt-outs, and Peerly then runs
  // its own DNC scrub. So capture (clamped to this hold) is never clamped DOWN,
  // and the send never costs more than was authorized.
  private async resolvePreBuildHoldAmount(build: {
    voterFileFilterId: number | null
    organizationSlug: string
  }): Promise<number> {
    // A SAVED voter list is required so the estimate is the filter's has-cell
    // count. Without one the only match count getListDetail could give is the
    // whole district's (segment undefined) — a valid but absurdly loose upper
    // bound that would place a huge hold. Fail closed instead.
    if (build.voterFileFilterId === null) {
      throw new BadRequestException(
        'A saved voter list is required to pay before the phone list is built',
      )
    }

    const matchCount = await this.resolveSmsMatchCount(
      build.voterFileFilterId,
      build.organizationSlug,
    )

    // OVER THE BUILD LIMIT: the build refuses a filter matching more than
    // MAX_AUDIENCE_RECIPIENTS (resolveFilterAudience's cap, which the build
    // measures on the same hasCellPhone-forced count this estimate reads). A hold
    // placed on such a filter would strand — the build can never complete to
    // finalize/capture it. Refuse checkout before the hold is placed.
    if (matchCount > MAX_AUDIENCE_RECIPIENTS) {
      throw new BadRequestException(
        `This voter list matches over the ${MAX_AUDIENCE_RECIPIENTS} ` +
          'phone-list limit — narrow the filter and try again.',
      )
    }

    const estimate = calcTextAmountInCents(matchCount)

    // ZERO-AMOUNT PRE-BUILD GUARD: a $0 send places no hold and seeds no
    // satellite link, so R1's build-ready recovery edges (which find a paid
    // pre-build draft through that link) could never find it — it would strand
    // unsent. Refuse it; it must wait for the build, where the ready-path
    // finalize has a phoneListId and cannot strand. A sub-50c estimate reads as
    // $0 (below Stripe's auth floor), the same forgiveness the ready path applies.
    if (estimate < WIN_SMS_HOLD_MIN_CENTS) {
      throw new BadRequestException(
        'This text send is free — wait for the list to finish building, then ' +
          'schedule it.',
      )
    }
    return estimate
  }

  // The has-cell match count for a saved voter list — the pre-pay SMS
  // reachability figure (getListDetail reachability.sms), re-derived server-side
  // so the hold never trusts a client-supplied count. Money code: a missing org
  // or a null count fails closed rather than placing a hold off an unknown
  // basis.
  private async resolveSmsMatchCount(
    voterFileFilterId: number,
    organizationSlug: string,
  ): Promise<number> {
    const organization = await this.organizationsService.findFirst({
      where: { slug: organizationSlug },
    })
    if (!organization) {
      throw new BadRequestException('Organization not found for this purchase')
    }
    const detail = await this.contactsService.getListDetail(
      { segment: voterFileFilterId },
      organization,
    )
    const smsReachable = detail.reachability.sms
    if (smsReachable === null) {
      throw new BadRequestException(
        'Could not estimate the SMS-reachable audience for this list',
      )
    }
    return smsReachable
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

    return this.billedCountFromCapturedList(
      capturedList,
      clientContactCount,
      campaignId,
      phoneListToken,
    )
  }

  // The server-derived billable count for a captured list the caller already
  // fetched: Peerly's own leads_loaded (the vendor's count of what got
  // uploaded), falling back to the captured recipient rows when Peerly can't be
  // reached. Split out of resolveBilledContactCount so the Win SMS hold path can
  // reuse the SAME build row it looked up to decide ready-vs-pre-build, rather
  // than hitting the DB a second time.
  private async billedCountFromCapturedList(
    capturedList: { id: string; peerlyListId: number | null },
    clientContactCount: number,
    campaignId: number,
    phoneListToken: string,
  ): Promise<number> {
    const peerlyLeadsLoaded = await this.fetchLeadsLoadedFromPeerly(
      phoneListToken,
      capturedList.peerlyListId,
    )
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

  // checkPhoneListStatus/getPhoneListDetails re-throw a non-2xx Peerly
  // response as BadGatewayException with the original axios error as
  // `cause` (PeerlyErrorHandlingService.handleApiError). A 4xx means Peerly
  // understood the request and refused it — there's no reason to expect a
  // retry would fix it, and billing off the pre-scrub captured rows in that
  // state risks the same overbill this file exists to prevent. A 5xx or
  // network failure carries no such signal, so the reasonable-estimate
  // fallback still applies there.
  private isPeerlyClientError(error: unknown): boolean {
    const cause = error instanceof Error ? error.cause : undefined
    const status = isAxiosError(cause) ? cause.response?.status : undefined
    return status !== undefined && status >= 400 && status < 500
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
    capturedListId: number | null,
  ): Promise<number | null> {
    let status
    try {
      status =
        await this.peerlyPhoneListService.checkPhoneListStatus(phoneListToken)
    } catch (error) {
      if (this.isPeerlyClientError(error)) {
        throw new BadRequestException(
          'Peerly rejected the phone list request; the purchase cannot proceed',
        )
      }
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
    // still omit it (not yet assigned, or a Peerly inconsistency). Fall back
    // to the DB's own peerlyListId — stamped durably once by an earlier
    // successful poll — before treating this as unresolved; either way,
    // falling back further to captured rows would hit the same pre-scrub
    // overbill the null-status check above exists to prevent.
    const listId = status.Data.list_id ?? capturedListId
    if (listId === null) {
      throw new BadRequestException(
        'Phone list has no list_id yet; try again shortly',
      )
    }

    try {
      return (await this.peerlyPhoneListService.getPhoneListDetails(listId))
        .leads_loaded
    } catch (error) {
      if (this.isPeerlyClientError(error)) {
        throw new BadRequestException(
          'Peerly rejected the phone list details request; the purchase cannot proceed',
        )
      }
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

  async executePaymentFailed(
    sessionId: string,
    rawMetadata: unknown,
  ): Promise<void> {
    if (
      !rawMetadata ||
      typeof rawMetadata !== 'object' ||
      !('outreachId' in rawMetadata) ||
      !('campaignId' in rawMetadata)
    ) {
      return
    }

    const outreachId = Number(rawMetadata.outreachId)
    const campaignId = Number(rawMetadata.campaignId)
    if (!outreachId || !campaignId) {
      return
    }

    await this.outreachService.failOutreachPurchase(
      outreachId,
      campaignId,
      sessionId,
    )
    this.logger.info(
      `Outreach ${outreachId} marked failed: payment ${sessionId} never settled`,
    )
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

    // Win SMS hold billing: record the authorization hold on the satellite
    // BEFORE finalizing the send. The hold is already placed by Stripe at
    // checkout; recording first means a later finalize failure (which reverts
    // and lets the webhook retry) never leaves held money unrecorded. Scoped to
    // the paid checkout path (a `cs_` id) — a sub-50c forgiven campaign takes
    // the free path (`free_confirmed_*`) and places no hold. CAS-idempotent, so
    // a webhook retry re-runs it safely. Capture + release are later slices.
    if (
      isWinSmsHoldBillingEnabled() &&
      outreachId &&
      paymentIntentId.startsWith('cs_')
    ) {
      // The upload token rides in the checkout metadata (as a string); pass it
      // so recordHold links the satellite to its building phone list now, before
      // the list is ready and before Outreach.phoneListId exists.
      const phoneListToken =
        'phoneListToken' in rawMetadata &&
        typeof rawMetadata.phoneListToken === 'string'
          ? rawMetadata.phoneListToken
          : undefined
      await this.p2pSmsHold.recordHold({
        outreachId,
        checkoutSessionId: paymentIntentId,
        phoneListToken,
      })
    }

    // Finalize before redeeming: a throw here must reach the caller so the
    // idempotency marker is never stamped and Stripe retries the webhook.
    // Sessions without an outreachId predate draft-first — for those the
    // campaign was (or will be) created by the client's own POST /outreach.
    if (outreachId) {
      const finalized = await this.outreachService.finalizeOutreachPurchase(
        outreachId,
        campaignId,
        paymentIntentId,
      )
      // Under the hold flag a pre-build draft defers (finalized === false): the
      // send is submitted later from the build-ready edge, so don't log it as
      // finalized here or the operational trail reads a false confirmation.
      this.logger.info(
        finalized
          ? `Outreach ${outreachId} finalized after payment ${paymentIntentId}`
          : `Outreach ${outreachId} payment recorded; finalize deferred to the build-ready edge (${paymentIntentId})`,
      )
      // Durable record of what funded this send. The first arg is the
      // checkout session id on the paid path and a synthetic
      // free_confirmed_* marker on the zero-amount path, so each lands in
      // its own column: the Stripe session is what cancel-before-send
      // resolves a refund from, and the free marker is what tells the CAS
      // approval gate a zero-amount send was actually granted rather than
      // never purchased. Additive: a failure here must not undo the
      // finalize above, and the webhook retry re-runs this write.
      if (paymentIntentId.startsWith('cs_')) {
        await this.outreachService.recordCheckoutSession(
          outreachId,
          campaignId,
          paymentIntentId,
        )
      } else {
        await this.outreachService.recordFreePurchase(
          outreachId,
          campaignId,
          paymentIntentId,
        )
      }
    }

    try {
      const hasOffer =
        await this.campaignsService.checkFreeTextsEligibility(campaignId)
      if (hasOffer) {
        if (outreachId) {
          // Stamp BEFORE redeeming, and let any failure propagate: the
          // idempotency marker is then never written, Stripe redelivers,
          // and the retry re-runs whatever is left. Ordering makes the
          // invariant one-directional — a consumed promo always has a
          // stamped row, so the cancel path's restore can trust the
          // count. An unstampable row (missing, or no textCount) skips
          // redemption the same way the legacy branch does: the offer
          // stays with the candidate — the safe direction — rather than
          // being consumed unstamped or retry-storming the webhook over
          // a permanent data anomaly.
          const stamped = await this.outreachService.markFreeTextsConsumed(
            outreachId,
            campaignId,
          )
          if (stamped) {
            // Win SMS hold billing: record the per-send, server-authoritative
            // "this send redeemed the offer" signal BEFORE flipping the campaign
            // flag, so the capture's discount decision never depends on the
            // client-supplied billableTextCount. Ordered before redeemFreeTexts
            // so there is no instant where the offer is consumed (flag flipped)
            // but the per-send signal is still unset — which the capture gate
            // would otherwise read as "full price" and overcharge.
            if (
              isWinSmsHoldBillingEnabled() &&
              paymentIntentId.startsWith('cs_')
            ) {
              await this.p2pSmsHold.markFreeTextsApplied(outreachId)
            }
            await this.campaignsService.redeemFreeTexts(campaignId)
            this.logger.info(
              `Free texts offer redeemed for campaign ${campaignId} after payment ${paymentIntentId}`,
            )
          } else {
            this.logger.warn(
              `Free texts offer left unredeemed for campaign ${campaignId}: ` +
                `outreach ${outreachId} could not be stamped`,
            )
          }
        } else {
          // Pre-draft-first sessions carry no outreachId. Consuming the
          // offer with no row to stamp would silently defeat the cancel
          // path's restore, so the offer is left with the candidate.
          this.logger.warn(
            `Free texts offer left unredeemed for campaign ${campaignId}: ` +
              `payment ${paymentIntentId} has no outreachId to stamp`,
          )
        }
      }
    } catch (error) {
      this.logger.error(
        { error },
        `Failed to redeem free texts offer for campaign ${campaignId} after payment ${paymentIntentId}:`,
      )
      throw error
    }

    // CAPTURE edge (a): attempt the capture only AFTER finalize and the
    // free-texts redemption have run — the discount is read at capture from the
    // per-send stamp (`billableTextCount`) that `markFreeTextsConsumed` writes
    // in the block above, so capturing earlier would miss an eligible campaign's
    // discount and overcharge. If the build is already `ready` (the common
    // ordering — the list is built before checkout), this captures now;
    // otherwise it no-ops and the build-ready edge or the backstop sweep fires
    // once the list finishes. Best-effort: a capture failure must not fail the
    // webhook (finalize already ran, and the backstop re-captures), and it runs
    // last so it can never strand the send setup. Self-gated on the flag.
    if (
      isWinSmsHoldBillingEnabled() &&
      outreachId &&
      paymentIntentId.startsWith('cs_')
    ) {
      try {
        await this.p2pSmsCapture.captureHold(outreachId)
      } catch (error) {
        this.logger.error(
          { error, outreachId },
          'win sms capture (post-hold edge) failed; backstop sweep will retry',
        )
      }
    }
  }
}
