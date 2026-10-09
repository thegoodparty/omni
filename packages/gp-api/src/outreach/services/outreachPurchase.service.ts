import { BadRequestException, Injectable } from '@nestjs/common'
import { isAxiosError } from 'axios'
import { CampaignsService } from 'src/campaigns/services/campaigns.service'
import {
  ContactsFilterResolutionInput,
  ContactsService,
} from 'src/contacts/services/contacts.service'
import { MAX_AUDIENCE_RECIPIENTS } from 'src/contacts/utils/audienceResolution.util'
import { OrganizationsService } from 'src/organizations/services/organizations.service'
import { PurchaseHandler } from 'src/payments/purchase.types'
import { FREE_TEXTS_OFFER } from 'src/shared/constants/freeTextsOffer'
import {
  calcTextAmountInCents,
  maxTextsForAmountInCents,
} from 'src/shared/util/textPricing.util'
import { PeerlyPhoneListCaptureService } from 'src/vendors/peerly/services/peerlyPhoneListCapture.service'
import { PeerlyPhoneListService } from 'src/vendors/peerly/services/peerlyPhoneList.service'
import { p2pPhoneListRequestSchema } from 'src/vendors/peerly/schemas/p2pPhoneListRequest.schema'
import { VoterFileFilterService } from 'src/voters/services/voterFileFilter.service'
import {
  isWinSmsHoldBillingEnabled,
  WIN_SMS_HOLD_MIN_CENTS,
} from 'src/shared/util/winSmsHold.util'
import { PeerlyPhoneList, PhoneListBuildStatus } from '../../generated/prisma'
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
    private readonly voterFileFilterService: VoterFileFilterService,
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
    phoneListBuildId,
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
        phoneListBuildId,
        campaignId,
        contactCount,
      )
    }

    const billedContactCount = await this.resolveBilledContactCount(
      phoneListToken,
      phoneListBuildId,
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
    phoneListBuildId: string | undefined,
    campaignId: number,
    clientContactCount: number,
  ): Promise<number> {
    const build = await this.resolvePurchaseBuild(
      phoneListToken,
      phoneListBuildId,
      campaignId,
    )

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

    let amount: number
    if (build.buildStatus !== PhoneListBuildStatus.ready) {
      amount = await this.resolvePreBuildHoldAmount(build)
    } else {
      const builtContactCount = await this.billedCountFromCapturedList(
        build,
        clientContactCount,
        campaignId,
      )
      const undiscounted = calcTextAmountInCents(builtContactCount)
      amount = undiscounted < WIN_SMS_HOLD_MIN_CENTS ? 0 : undiscounted
    }

    // HARD send cap (slice D2b — never oversend): persist the paid text count
    // this hold covers onto the build NOW, at session-creation, so the async
    // build-upload caps to it even when its resolve runs before the payment
    // webhook links the hold (the race D2a's satellite-link cap could not
    // close). The paid session's amount equals the authorized hold, so this
    // value is exactly `maxTextsForAmountInCents(authorizedAmountInCents)`. Only
    // a real hold (amount > 0) caps — a forgiven/free amount places no hold and
    // sends nothing to cap (and a pre-build $0 is refused upstream anyway).
    //
    // Awaited, fail-closed on purpose: if the cap cannot be persisted, checkout
    // is blocked rather than letting a hold be authorized with no cap in place —
    // the safe posture for the money gate this slice exists to guarantee.
    if (amount > 0) {
      await this.peerlyPhoneListCapture.persistSendCap(
        build.id,
        maxTextsForAmountInCents(amount),
      )
    }
    return amount
  }

  // The pre-build hold amount: the has-cell match count of the EXACT filter the
  // build will resolve, priced undiscounted.
  //
  // UPPER-BOUND PROOF (money-safety): the build resolves the request snapshot
  // MERGED over the saved filter (resolveFilterInput: `{ ...savedFilter,
  // ...snapshotFilterInput }`) with hasCellPhone forced, then subtracts
  // (incomplete address, duplicate phones, org opt-outs) and Peerly runs its DNC
  // scrub. This estimate counts that SAME merged filter with hasCellPhone forced
  // (and WITHOUT the opt-out subtraction, so it is if anything larger) — so it is
  // provably >= the eventual leads_loaded regardless of what the client round-
  // trips. Pricing off the saved filter ALONE would break the bound: the FE
  // round-trips the whole row, and a saved narrowing (e.g. `search`) that the
  // snapshot overrides to null (search is nullish) would make the build resolve a
  // WIDER audience than a saved-filter-only count saw.
  private async resolvePreBuildHoldAmount(build: {
    organizationSlug: string
    requestSnapshot: unknown
  }): Promise<number> {
    const mergedFilter = await this.resolveBuildMergedFilter(build)

    const matchCount = await this.countSmsReachable(
      mergedFilter,
      build.organizationSlug,
    )

    // OVER THE BUILD LIMIT (conservative, fail-closed): the async build caps on
    // RESOLVED recipients (matchCount minus incomplete-address/duplicate/opt-out
    // rows), not this matched has-cell count, so matchCount is an UPPER bound of
    // what the build would resolve. Refusing when it exceeds the cap can turn away
    // a filter the build could still complete (matched over the cap but resolving
    // under it) — the safe error: it never places a hold on a filter whose build
    // would overrun the cap and strand it. A precise check would need the full
    // resolution, which is the build's job, not the estimate's.
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

  // Rebuilds the EXACT filter the queued build will resolve, from the build's own
  // stored request snapshot — mirroring P2pPhoneListUploadService.resolveFilterInput
  // (`{ ...savedFilter, ...snapshotFilterInput }`) so the estimate and the build
  // can never diverge. Fail-closed: an absent/invalid snapshot (the async build
  // itself would reject it and park `failed`) and a missing saved list both throw
  // rather than estimating off a different filter. A SAVED voter list is required
  // (the pre-build flow is saved-list based) so the estimate is never the whole
  // district's has-cell count.
  private async resolveBuildMergedFilter(build: {
    organizationSlug: string
    requestSnapshot: unknown
  }): Promise<ContactsFilterResolutionInput> {
    const parsed = p2pPhoneListRequestSchema.safeParse(build.requestSnapshot)
    if (!parsed.success) {
      throw new BadRequestException(
        'The phone list build request is missing or invalid; cannot estimate',
      )
    }
    const { name: _name, ...filterInput } = parsed.data
    if (!filterInput.voterFileFilterId) {
      throw new BadRequestException(
        'A saved voter list is required to pay before the phone list is built',
      )
    }
    const filter =
      await this.voterFileFilterService.findByIdAndOrganizationSlug(
        filterInput.voterFileFilterId,
        build.organizationSlug,
      )
    if (!filter) {
      throw new BadRequestException('Voter list not found for this purchase')
    }
    // EXACTLY the build's merge order — snapshot fields override the saved row.
    return { ...filter, ...filterInput }
  }

  // Counts the has-cell-phone set of a resolved filter the SAME way the build
  // does: findContactsForFilter with hasCellPhone forced, read as the page-1
  // total. This is the build's own matched count (resolveFilterAudience forces
  // the same constraint and pages off the same total); the build then only
  // subtracts from it, so this is a true upper bound of leads_loaded. The opt-out
  // scrub is deliberately NOT applied here — omitting it can only make the count
  // larger, which keeps the bound. Money code: a missing org fails closed.
  private async countSmsReachable(
    mergedFilter: ContactsFilterResolutionInput,
    organizationSlug: string,
  ): Promise<number> {
    const organization = await this.organizationsService.findFirst({
      where: { slug: organizationSlug },
    })
    if (!organization) {
      throw new BadRequestException('Organization not found for this purchase')
    }
    const { pagination } = await this.contactsService.findContactsForFilter(
      { ...mergedFilter, hasCellPhone: true },
      { resultsPerPage: 1, page: 1 },
      organization,
    )
    return pagination.totalResults
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
    phoneListBuildId: string | undefined,
    campaignId: number,
    clientContactCount: number,
  ): Promise<number> {
    // FLAG-OFF INERTNESS: the buildId handle only exists for the async-build
    // path gated behind WIN_SMS_HOLD_BILLING (resolveWinSmsHoldAmount). With
    // the flag off this must resolve exactly as it did before that slice —
    // token-only — so a crafted buildId in checkout metadata can't reach a
    // list the pre-slice code would have refused.
    const capturedList = await this.resolvePurchaseBuild(
      phoneListToken,
      isWinSmsHoldBillingEnabled() ? phoneListBuildId : undefined,
      campaignId,
    )

    return this.billedCountFromCapturedList(
      capturedList,
      clientContactCount,
      campaignId,
    )
  }

  // Resolves the PeerlyPhoneList this p2p purchase bills against, scoped to the
  // server-validated campaign so a client-supplied handle can never reach
  // another campaign's list. Both handles ride in client-controlled checkout
  // metadata, so BOTH lookups carry the campaignId — this is the one ownership
  // proof every billing/cap/link path runs through, and it runs here (at
  // calculateAmount) BEFORE a Stripe session or any hold exists.
  //
  // The token path is unchanged and takes precedence: a globally-@unique token
  // is resolved first, and the buildId path is used ONLY when no token is
  // present (an async build returns a null token until it reaches Peerly). A
  // buildId that does not belong to the campaign resolves to null here and is
  // refused with the SAME shape the token path uses — never billed or linked.
  private async resolvePurchaseBuild(
    phoneListToken: string | undefined,
    phoneListBuildId: string | undefined,
    campaignId: number,
  ): Promise<PeerlyPhoneList> {
    const where = phoneListToken
      ? { token: phoneListToken, campaignId }
      : phoneListBuildId
        ? { id: phoneListBuildId, campaignId }
        : null
    if (!where) {
      throw new BadRequestException(
        'A phone list is required to bill a p2p purchase',
      )
    }
    const build = await this.peerlyPhoneListCapture.findFirst({ where })
    if (!build) {
      throw new BadRequestException('No phone list found for this purchase')
    }
    return build
  }

  // The server-derived billable count for a captured list the caller already
  // fetched: Peerly's own leads_loaded (the vendor's count of what got
  // uploaded), falling back to the captured recipient rows when Peerly can't be
  // reached. Split out of resolveBilledContactCount so the Win SMS hold path can
  // reuse the SAME build row it looked up to decide ready-vs-pre-build, rather
  // than hitting the DB a second time.
  private async billedCountFromCapturedList(
    capturedList: {
      id: string
      peerlyListId: number | null
      token: string | null
    },
    clientContactCount: number,
    campaignId: number,
  ): Promise<number> {
    // The list's OWN token (identical to the request token on the token path,
    // which resolved the row BY it) — so the buildId path, which carries no
    // request token, fetches leads_loaded the same way. A `ready` build always
    // carries a token (stamped at upload before ready); a tokenless row here is
    // a data anomaly we refuse rather than bill off the pre-scrub captured rows.
    const phoneListToken = capturedList.token
    if (!phoneListToken) {
      throw new BadRequestException('No phone list found for this purchase')
    }
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
      // the list is ready and before Outreach.phoneListId exists. An async build
      // carries no token — it rides the build id instead, which recordHold links
      // by (scoped to this campaign, since the id is client-supplied).
      const phoneListToken =
        'phoneListToken' in rawMetadata &&
        typeof rawMetadata.phoneListToken === 'string'
          ? rawMetadata.phoneListToken
          : undefined
      const phoneListBuildId =
        'phoneListBuildId' in rawMetadata &&
        typeof rawMetadata.phoneListBuildId === 'string'
          ? rawMetadata.phoneListBuildId
          : undefined
      await this.p2pSmsHold.recordHold({
        outreachId,
        checkoutSessionId: paymentIntentId,
        phoneListToken,
        phoneListBuildId,
        campaignId,
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
