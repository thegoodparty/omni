import {
  BadGatewayException,
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common'
import { ModuleRef } from '@nestjs/core'
import { CheckoutSessionMode, WebhookEventType } from '../payments.types'
import Stripe from 'stripe'
import { CampaignsService } from '../../campaigns/services/campaigns.service'
import { UsersService } from '../../users/services/users.service'
import { SlackService } from '../../vendors/slack/services/slack.service'
import { Campaign, User } from '../../generated/prisma'
import { DateFormats, formatDate } from '../../shared/util/date.util'
import { getUserFullName } from '../../users/util/users.util'
import { EmailService } from '../../email/email.service'
import { SlackChannel } from '../../vendors/slack/slackService.types'
import { IS_PROD_DEPLOY } from 'src/shared/util/appEnvironment.util'
import { CrmCampaignsService } from '../../campaigns/services/crmCampaigns.service'
import { OrganizationsService } from '../../organizations/services/organizations.service'
import { VoterFileDownloadAccessService } from '../../shared/services/voterFileDownloadAccess.service'
import { AnalyticsService } from 'src/analytics/analytics.service'
import { EVENTS } from 'src/vendors/segment/segment.types'
import { WrapperType } from 'src/shared/types/utility.types'
import { PurchaseService } from './purchase.service'
import { PinoLogger } from 'nestjs-pino'
import { CampaignTcrComplianceService } from '../../campaigns/tcrCompliance/services/campaignTcrCompliance.service'
import { RaceOpponentService } from '../../raceOpponent/services/raceOpponent.service'
import { OutreachRobocallWebhookService } from '../../outreach/services/outreachRobocallWebhook.service'
import { StripeService } from '../../vendors/stripe/services/stripe.service'

const { STRIPE_WEBSOCKET_SECRET } = process.env
if (!STRIPE_WEBSOCKET_SECRET) {
  throw new Error('Please set STRIPE_WEBSOCKET_SECRET in your .env')
}

// The two Stripe statuses a subscription can never bill from again. Every other
// status — active, trialing, past_due, unpaid, incomplete, paused — can still
// take the candidate's money, or resume taking it once a payment succeeds.
const UNBILLABLE_SUBSCRIPTION_STATUSES = new Set<Stripe.Subscription.Status>([
  'canceled',
  'incomplete_expired',
])

// How long after Stripe mints a subscription an unmatched lookup is still
// assumed to be racing our own fulfillment write rather than describing a
// genuine orphan. checkout.session.completed and customer.subscription.created
// are what store details.subscriptionId, and Stripe delivers sibling events
// concurrently with that write, not after it — ten minutes covers a slow
// finalize and a couple of redeliveries with room to spare.
const SUBSCRIPTION_WRITE_RACE_WINDOW_SECONDS = 10 * 60

@Injectable()
export class PaymentEventsService {
  constructor(
    private readonly usersService: UsersService,
    private readonly campaignsService: CampaignsService,
    private readonly slackService: SlackService,
    private readonly emailService: EmailService,
    private readonly crm: CrmCampaignsService,
    private readonly voterFileDownloadAccess: VoterFileDownloadAccessService,
    private readonly organizationsService: OrganizationsService,
    private readonly analytics: AnalyticsService,
    @Inject(forwardRef(() => PurchaseService))
    private readonly purchaseService: WrapperType<PurchaseService>,
    private readonly tcrComplianceService: CampaignTcrComplianceService,
    private readonly stripeService: StripeService,
    private readonly moduleRef: ModuleRef,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(PaymentEventsService.name)
  }

  // Auto-start opponent collection the moment a campaign first becomes Pro, so
  // research is already in flight before the candidate opens /opponent. Gated
  // and de-duplicated inside RaceOpponentService.autoCollectOnProUpgrade
  // (flag check + the same in-flight guard as the manual button and the daily
  // cron). Best-effort: a dispatch failure must never roll back the Pro upgrade
  // that just succeeded, so swallow and log here rather than rethrow.
  //
  // RaceOpponentService is resolved lazily via ModuleRef rather than injected:
  // importing RaceOpponentModule here closes a module cycle
  // (Payments -> RaceOpponent -> CampaignStrategy -> Websites -> Payments) that
  // a single forwardRef can't break.
  private async dispatchOpponentCollectionOnProUpgrade(campaignId: number) {
    try {
      const raceOpponentService = this.moduleRef.get(RaceOpponentService, {
        strict: false,
      })
      await raceOpponentService.autoCollectOnProUpgrade(campaignId)
    } catch (error) {
      this.logger.error(
        { error },
        `[WEBHOOK] Failed to auto-dispatch opponent collection - Campaign: ${campaignId}`,
      )
    }
  }

  async handleEvent(event: Stripe.Event) {
    switch (event.type) {
      case WebhookEventType.CustomerSubscriptionCreated:
        return await this.customerSubscriptionCreatedHandler(event)
      case WebhookEventType.CheckoutSessionCompleted:
        return await this.checkoutSessionCompletedHandler(event)
      case WebhookEventType.CheckoutSessionAsyncPaymentSucceeded:
        return await this.checkoutSessionAsyncPaymentSucceededHandler(event)
      case WebhookEventType.CheckoutSessionExpired:
        return await this.checkoutSessionExpiredHandler(event)
      case WebhookEventType.CustomerSubscriptionDeleted:
        return await this.customerSubscriptionDeletedHandler(event)
      case WebhookEventType.CustomerSubscriptionUpdated:
        return await this.customerSubscriptionUpdatedHandler(event)
      case WebhookEventType.CustomerSubscriptionResumed:
        return await this.customerSubscriptionResumedHandler(event)
      case WebhookEventType.PaymentMethodDetached:
        return await this.paymentMethodDetachedHandler(event)
      case WebhookEventType.PaymentMethodAttached:
        return await this.paymentMethodAttachedHandler(event)
      case WebhookEventType.ChargeDisputeCreated:
        return await this.chargeDisputeCreatedHandler(event)
    }
    this.logger.warn(`Stripe Event type ${event.type} not handled`)
  }

  // Resolved lazily via ModuleRef, like the opponent dispatch above:
  // OutreachModule imports PaymentsModule, so injecting the robocall service
  // here would close that cycle. strict:false searches the whole app graph.
  private robocallWebhookService(): OutreachRobocallWebhookService {
    return this.moduleRef.get(OutreachRobocallWebhookService, { strict: false })
  }

  // payment_method.detached: a candidate removed a saved card. Cancel any
  // robocall run bound to it that has NOT dialed and release its hold — never
  // leave an authorization standing against a revoked card, and never dial one.
  // Runs already dialing/dialed/settling/captured/charged are left untouched
  // (their calls happened; capture must proceed). Idempotent across Stripe
  // redeliveries via the per-row state CAS in the service.
  async paymentMethodDetachedHandler(
    event: Stripe.PaymentMethodDetachedEvent,
  ): Promise<void> {
    await this.robocallWebhookService().cancelNotYetDialedForDetachedPaymentMethod(
      event.data.object.id,
    )
  }

  // payment_method.attached: a candidate added/updated a saved card (via the pay
  // step's SetupIntent or the billing portal). Immediately retry the hold for
  // this customer's hold_failed robocall drafts whose send is still ahead — the
  // team flow's "card updated before send time → retry the hold now" arm, so the
  // candidate does not wait for the daily reminder. Cards only; the service owns
  // the per-draft placement CAS.
  async paymentMethodAttachedHandler(
    event: Stripe.PaymentMethodAttachedEvent,
  ): Promise<void> {
    const pm = event.data.object
    const customerId =
      typeof pm.customer === 'string' ? pm.customer : pm.customer?.id
    if (!customerId || pm.type !== 'card') {
      return
    }
    await this.robocallWebhookService().retryHoldFailedForAttachedCard(
      customerId,
      pm.id,
    )
  }

  // charge.dispute.created: mark the disputed robocall run and (integration
  // point in the service) block the campaign's future sends. Map the dispute's
  // payment intent back to the run so the wrong campaign is never marked.
  async chargeDisputeCreatedHandler(
    event: Stripe.ChargeDisputeCreatedEvent,
  ): Promise<void> {
    const dispute = event.data.object
    const intentId =
      typeof dispute.payment_intent === 'string'
        ? dispute.payment_intent
        : dispute.payment_intent?.id
    if (!intentId) {
      this.logger.warn(
        { disputeId: dispute.id },
        '[WEBHOOK] charge.dispute.created has no payment_intent; skipping',
      )
      return
    }
    await this.robocallWebhookService().markDisputedByIntent(intentId)
  }

  async customerSubscriptionCreatedHandler(
    event: Stripe.CustomerSubscriptionCreatedEvent,
  ) {
    const { id: subscriptionId, customer: customerId } = event.data.object
    if (!subscriptionId) {
      throw new BadRequestException('No subscriptionId found in subscription')
    }

    // Stripe SDK uses broad union types — metadata and IDs are string | null | Stripe.* unions
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const user = await this.usersService.findByCustomerId(customerId as string)
    if (!user) {
      throw new BadGatewayException(
        'No user found with given subscription customerId',
      )
    }
    const campaign = await this.campaignsService.findActiveByUserId(user.id)
    if (!campaign) {
      this.logger.warn(
        { userId: user.id },
        '[WEBHOOK] No active campaign on subscription.created; skipping',
      )
      return
    }

    return this.campaignsService.patchCampaignDetails(campaign.id, {
      subscriptionId,
    })
  }

  async customerSubscriptionResumedHandler(
    event: Stripe.CustomerSubscriptionResumedEvent,
  ) {
    const subscription = event.data.object
    const { customer: customerId, id: subscriptionId } = subscription
    if (!customerId) {
      throw new BadRequestException('No customerId found in subscription')
    }

    // Stripe SDK uses broad union types — metadata and IDs are string | null | Stripe.* unions
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const user = await this.usersService.findByCustomerId(customerId as string)
    if (!user) {
      throw new BadGatewayException(
        'No user found with given subscription customerId',
      )
    }
    const campaign = await this.campaignsService.findActiveByUserId(user.id)
    if (!campaign) {
      this.logger.warn(
        { userId: user.id },
        '[WEBHOOK] No active campaign on subscription.resumed; skipping',
      )
      return
    }
    const { id: campaignId } = campaign

    // These have to happen in serial since setIsPro also mutates the JSONP details column
    await this.campaignsService.patchCampaignDetails(campaignId, {
      subscriptionId: subscriptionId as string,
    })
    const { becamePro } = await this.campaignsService.setIsPro(campaignId)

    if (becamePro) {
      await this.dispatchOpponentCollectionOnProUpgrade(campaignId)
    }

    await Promise.allSettled([
      this.sendProSubscriptionResumedSlackMessage(user, campaign),
      (async () => {
        const { district, ballotLevel } = campaign.organizationSlug
          ? await this.organizationsService.getDistrictAndBallotLevelForOrgSlug(
              campaign.organizationSlug,
            )
          : { district: null, ballotLevel: null }
        await this.voterFileDownloadAccess.downloadAccessAlert(
          campaign,
          user,
          district,
          ballotLevel,
        )
      })(),
    ])
  }

  // Both subscription handlers below resolve their campaign through
  // details.subscriptionId, and both used to throw BadGatewayException when that
  // lookup missed. The throw was wrong twice over: a missing local row is not a
  // third-party failure (AGENTS.md § Exception handling reserves 502 for those),
  // and redelivery re-runs the same query against the same rows, so Stripe spent
  // 7 attempts over ~68h raising one alert each on a state that cannot change.
  //
  // Acknowledging is right only because no redelivery can change the answer,
  // which is true of every miss EXCEPT one: the write that stores
  // details.subscriptionId is ours and lands seconds after checkout, so a
  // subscription minted minutes ago may simply not be linked yet. That one
  // keeps its retry (see below).
  //
  // Acknowledging silently would bury the reason the miss matters. One lookup
  // failure covers three conditions with three very different costs, and the
  // event payload separates them:
  //
  // - Still billable. The customer is being charged and no campaign is being
  //   served. UsersService.deleteUser cancels the subscription, so a billable
  //   subscription can never be deletion residue — this is the
  //   paying-but-not-Pro shape of ENG-10771 / ENG-11083.
  // - Canceled, account still live — by the stored customer id, or failing that
  //   by the email on the billing Stripe customer. The de-Pro never ran, so the
  //   campaign may still be Pro, or its subscriptionId was orphaned by a
  //   duplicate checkout (ENG-11084). Money stopped and fulfillment did not
  //   follow: the one shape this file must never swallow.
  // - Canceled, no account. deleteUser cascade-deletes the campaign and the user
  //   row in one transaction and cancels Stripe afterwards, so the cancellation
  //   lands with nothing left to un-Pro. No redelivery and no human can act.
  //
  // Only the last is quiet. The other two error-log — what the Loki alert
  // pipeline keys on — in the same "alert loudly, don't block fulfillment"
  // shape as the ENG-11084 duplicate-subscription guard in
  // handleSubscriptionCheckoutCompleted.
  private async reportUnmatchedSubscription(
    event:
      | Stripe.CustomerSubscriptionUpdatedEvent
      | Stripe.CustomerSubscriptionDeletedEvent,
  ): Promise<void> {
    const subscription = event.data.object
    const customerId =
      typeof subscription.customer === 'string'
        ? subscription.customer
        : subscription.customer.id
    const context = {
      eventType: event.type,
      subscriptionId: subscription.id,
      customerId,
      status: subscription.status,
      cancelAt: subscription.cancel_at,
      canceledAt: subscription.canceled_at,
      cancellationReason: subscription.cancellation_details?.reason ?? null,
    }

    // The one miss redelivery can still fix. Our own fulfillment writes the id
    // this lookup reads, and Stripe delivers a subscription's sibling events
    // concurrently with that write rather than after it, so a freshly minted
    // subscription may be unlinked for a few seconds rather than orphaned.
    // Keeping the retry here is what stops a cancellation that beat its own
    // checkout from being dropped, and a first-time Pro upgrade from being
    // reported as an unserved paying customer. 503 rather than the old 502:
    // this is our state catching up, not a Stripe failure (#1937). The window
    // closes on its own, so a genuine orphan minted minutes ago falls through
    // to the classification below on a later attempt instead of retrying for
    // three days.
    const subscriptionAgeSeconds = Date.now() / 1000 - subscription.created
    if (subscriptionAgeSeconds < SUBSCRIPTION_WRITE_RACE_WINDOW_SECONDS) {
      this.logger.warn(
        { ...context, subscriptionAgeSeconds },
        '[WEBHOOK] Unmatched Stripe subscription is younger than the ' +
          'fulfillment write that links it — asking Stripe to redeliver',
      )
      throw new ServiceUnavailableException(
        'Subscription is not linked to a campaign yet',
      )
    }

    if (!UNBILLABLE_SUBSCRIPTION_STATUSES.has(subscription.status)) {
      this.logger.error(
        context,
        '[WEBHOOK] Unmatched Stripe subscription is still billable — the ' +
          'customer is being charged with no campaign carrying their ' +
          'subscriptionId',
      )
      return
    }

    // The Stripe customer is the only remaining link back to an account: Pro
    // checkouts write no userId onto the subscription itself, only onto the
    // checkout session, which is long gone by the time a cancellation arrives.
    const accountByStoredId =
      await this.usersService.findByCustomerId(customerId)
    const emailFallback = accountByStoredId
      ? null
      : await this.resolveAccountByStripeCustomerEmail(customerId)
    const user = accountByStoredId ?? emailFallback?.user ?? null

    if (!user || user.metaData?.isDeleted) {
      this.logger.warn(
        {
          ...context,
          userId: user?.id ?? null,
          emailFallback: emailFallback?.outcome ?? 'not-needed',
        },
        '[WEBHOOK] Unmatched canceled Stripe subscription resolves to no live ' +
          'account by stored customer id or Stripe customer email — ' +
          'consistent with account deletion; nothing left to un-Pro',
      )
      return
    }

    if (accountByStoredId) {
      this.logger.error(
        { ...context, userId: user.id, matchedBy: 'storedCustomerId' },
        '[WEBHOOK] Unmatched canceled Stripe subscription belongs to a live ' +
          'account — the Pro cancellation was never applied',
      )
      return
    }

    // Deliberately a separate line from the stored-id match above: the evidence
    // is weaker and the reader has to know which they are looking at. A stored
    // customerId that disagrees with the one actually billing is itself the
    // ENG-11084 signature, so log both rather than only the billing one.
    this.logger.error(
      {
        ...context,
        userId: user.id,
        matchedBy: 'stripeCustomerEmail',
        storedCustomerId: user.metaData?.customerId ?? null,
      },
      '[WEBHOOK] Unmatched canceled Stripe subscription matches a live account ' +
        'by the email on its Stripe customer, not by the stored customer id — ' +
        'the Pro cancellation was never applied. Confirm the account before ' +
        'acting: checkout emails are candidate-entered',
    )
  }

  // meta_data.customerId is the strong link, and it is mostly missing: a
  // reconciliation of every unmatched production subscription on 2026-09-17
  // resolved 1 of 20 through it, and 0 of the 6 canceled ones. Pre-ENG-11084
  // email-only checkout minted a fresh Stripe customer per session, so the
  // customer that ends up billing is routinely not the one stored on the user.
  // Without this fallback the two confirmed lost cancellations both land on the
  // warn — the condition this file exists to never swallow, swallowed.
  //
  // It stays a fallback, and nothing acts on it: candidates type arbitrary
  // addresses at checkout (§ Debugging Pro billing issues), so an email hit is
  // grounds for a human to go look, not for code to re-link a subscription.
  private async resolveAccountByStripeCustomerEmail(customerId: string) {
    let email: string | null
    try {
      const customer = await this.stripeService.retrieveCustomer(customerId)
      email = customer.deleted ? null : customer.email
    } catch (error) {
      // This lookup can only ever raise a warn to an error. Letting it throw
      // would turn an event we had already classified into an unhandled 5xx and
      // restart the retry storm, so a Stripe failure degrades to the warn we
      // would have logged without it.
      this.logger.warn(
        { error, customerId },
        '[WEBHOOK] Could not read the Stripe customer to resolve an unmatched ' +
          'subscription by email',
      )
      return { user: null, outcome: 'stripe-unavailable' as const }
    }

    if (!email) {
      return { user: null, outcome: 'customer-has-no-email' as const }
    }

    // user_email_lower_unique (a unique index on LOWER(email)) is what makes a
    // case-insensitive match resolve to at most one account.
    const user = await this.usersService.findUserByEmail(email.toLowerCase())
    return user
      ? { user, outcome: 'matched' as const }
      : { user: null, outcome: 'no-match' as const }
  }

  async customerSubscriptionUpdatedHandler(
    event: Stripe.CustomerSubscriptionUpdatedEvent,
  ): Promise<void> {
    const { previous_attributes: previousAttributes, object: subscription } =
      event.data
    const {
      id: subscriptionId,
      canceled_at: canceledAt,
      cancel_at: cancelAt,
    } = subscription
    const { cancel_at: previousCancelAt } = previousAttributes || {}

    if (!subscriptionId) {
      throw new BadRequestException('No subscriptionId found in subscription')
    }

    const campaign =
      await this.campaignsService.findBySubscriptionId(subscriptionId)
    if (!campaign) {
      await this.reportUnmatchedSubscription(event)
      return
    }

    await this.campaignsService.patchCampaignDetails(campaign.id, {
      subscriptionCanceledAt: canceledAt,
      subscriptionCancelAt: cancelAt,
    })

    // Prisma optional relation — user is guaranteed by auth but Prisma types it as nullable
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const user = (await this.usersService.findByCampaign(campaign)) as User
    const isCancellationRequest =
      cancelAt && previousCancelAt && previousCancelAt > cancelAt
    isCancellationRequest &&
      (await this.emailService.sendCancellationRequestConfirmationEmail(
        user,
        formatDate(new Date((cancelAt as number) * 1000), DateFormats.usDate),
      ))
  }

  async checkoutSessionCompletedHandler(
    event: Stripe.CheckoutSessionCompletedEvent,
  ) {
    const session = event.data.object

    // Route to appropriate handler based on checkout session mode
    if (session.mode === CheckoutSessionMode.SUBSCRIPTION) {
      return this.handleSubscriptionCheckoutCompleted(session)
    } else if (session.mode === CheckoutSessionMode.PAYMENT) {
      return this.handleOneTimePaymentCheckoutCompleted(session)
    }

    this.logger.warn(`Unknown checkout session mode: ${session.mode}`)
  }

  /**
   * Handles checkout.session.async_payment_succeeded — fired when a delayed
   * payment method (e.g. ACH bank debit) settles, after the earlier
   * checkout.session.completed where fulfillment was deferred because the
   * payment was not yet confirmed. Async payments are always one-time
   * payment-mode checkouts, and payment_status is now 'paid', so fulfillment
   * proceeds (idempotently) via the same one-time-payment path.
   */
  private async checkoutSessionAsyncPaymentSucceededHandler(
    event: Stripe.CheckoutSessionAsyncPaymentSucceededEvent,
  ) {
    // Pass the event's session as the prefetched session: it already carries the
    // confirmed payment_status 'paid'. Re-fetching from Stripe here could read a
    // stale 'unpaid' (eventual consistency) and silently defer, dropping the
    // fulfillment with no retry.
    return this.handleOneTimePaymentCheckoutCompleted(
      event.data.object,
      event.data.object,
    )
  }

  /**
   * Handles checkout.session.completed events for subscription checkouts (Pro plan).
   */
  private async handleSubscriptionCheckoutCompleted(
    session: Stripe.Checkout.Session,
  ) {
    const { customer: customerId, subscription: subscriptionId } = session
    if (!customerId) {
      throw new BadGatewayException('No customerId found in checkout session')
    }

    const { userId } = session.metadata ? session.metadata : {}
    if (!userId) {
      throw new BadGatewayException(
        'No userId found in checkout session metadata',
      )
    }

    const user = await this.usersService.findUser({
      id: parseInt(userId),
    })

    if (!user) {
      throw new BadRequestException(
        'No user found with given checkout session userId',
      )
    }
    const campaign = await this.campaignsService.findActiveByUserId(user.id)
    if (!campaign) {
      this.logger.warn(
        { userId: user.id },
        '[WEBHOOK] No active campaign on subscription checkout; skipping',
      )
      return
    }

    // findActiveByUserId already guaranteed, via isActiveCampaign, a present and
    // valid electionDate that has not passed by UTC calendar day. The previous
    // instant `electionDate < new Date()` re-check wrongly 500'd an election-day
    // checkout (the run is active through the whole day), and re-deriving the
    // date here would duplicate the shared predicate.
    const { id: campaignId } = campaign

    // Stripe SDK uses broad union types — metadata and IDs are string | null | Stripe.* unions
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const incomingSubscriptionId = subscriptionId as string
    const previousSubscriptionId = campaign.details?.subscriptionId
    if (
      previousSubscriptionId &&
      previousSubscriptionId !== incomingSubscriptionId
    ) {
      // Overwriting a different stored sub id is the signature of a duplicate
      // Pro subscription: the previous sub keeps billing invisibly once we
      // stop tracking it (ENG-11084). Alert loudly, don't block fulfillment.
      this.logger.error(
        {
          campaignId,
          userId: user.id,
          previousSubscriptionId,
          incomingSubscriptionId,
        },
        '[WEBHOOK] Subscription checkout is replacing a different stored ' +
          'subscriptionId — possible duplicate Pro subscription',
      )
    }

    // These have to happen in serial since setIsPro also mutates the JSONP details column
    await this.campaignsService.patchCampaignDetails(campaignId, {
      subscriptionId: incomingSubscriptionId,
    })
    const { becamePro } = await this.campaignsService.setIsPro(campaignId)

    if (becamePro) {
      await this.dispatchOpponentCollectionOnProUpgrade(campaignId)
    }

    // Pre-payment submissions defer the compliance_setup agent
    // kickoff to here. No-ops when the candidate has no TCR record yet or the
    // kickoff was already enqueued. Best-effort: a failure here must not fail
    // the webhook (the stranded-kickoff sweep recovers a rolled-back claim).
    try {
      await this.tcrComplianceService.enqueueAgenticKickoffIfNeeded(campaignId)
    } catch (error) {
      this.logger.error(
        { error },
        `[WEBHOOK] Failed to enqueue agentic compliance kickoff - Campaign: ${campaignId}`,
      )
    }

    // Track analytics with proper error handling
    try {
      await this.analytics.trackProPayment(user.id, session)
    } catch (error) {
      this.logger.error(
        { error },
        `[WEBHOOK] Failed to track pro payment analytics - User: ${user.id}, Session: ${session.id}`,
      )
      // Don't throw - we don't want to fail the webhook for analytics issues
    }

    try {
      await this.analytics.track(user.id, EVENTS.Account.ProUpgradeComplete, {
        pro: true,
      })
    } catch (error) {
      this.logger.error(
        { error },
        `[WEBHOOK] Failed to track pro_upgrade_complete - User: ${user.id}, Session: ${session.id}`,
      )
    }

    // Critical: Update user metadata with customerId - must succeed
    await this.usersService.patchUserMetaData(user.id, {
      // Stripe SDK uses broad union types — metadata and IDs are string | null | Stripe.* unions
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      customerId: customerId as string,
    })

    // The clear must be conditional on the stored id still being this
    // completing session — a concurrent checkout may have stored a newer id,
    // and clearing it unconditionally would strand that session untracked.
    await this.usersService.compareAndSwapCheckoutSessionId(
      user.id,
      session.id,
      null,
    )

    // Non-critical: Send notifications - log failures but don't fail webhook
    const results = await Promise.allSettled([
      this.sendProSignUpSlackMessage(user, campaign),
      (async () => {
        const { district, ballotLevel } = campaign.organizationSlug
          ? await this.organizationsService.getDistrictAndBallotLevelForOrgSlug(
              campaign.organizationSlug,
            )
          : { district: null, ballotLevel: null }
        await this.voterFileDownloadAccess.downloadAccessAlert(
          campaign,
          user,
          district,
          ballotLevel,
        )
      })(),
    ])

    // Log any notification failures
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        const action = ['send Slack message', 'send voter file alert'][index]
        this.logger.error(
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          { reason: result.reason },
          `[WEBHOOK] Failed to ${action} - User: ${user.id}, CustomerId: ${customerId}`,
        )
      }
    })
  }

  /**
   * Handles checkout.session.completed events for one-time payment checkouts.
   * Routes to the appropriate post-purchase handler based on purchaseType in metadata.
   *
   * This handler is used for Custom Checkout Sessions created with `ui_mode: 'custom'`
   * that support promo codes.
   */
  private async handleOneTimePaymentCheckoutCompleted(
    session: Stripe.Checkout.Session,
    prefetchedSession?: Stripe.Checkout.Session,
  ) {
    const { id: sessionId, metadata } = session

    if (!metadata?.userId) {
      throw new BadGatewayException(
        'No userId found in checkout session metadata',
      )
    }

    if (!metadata?.purchaseType) {
      throw new BadGatewayException(
        'No purchaseType found in checkout session metadata',
      )
    }

    this.logger.info({
      sessionId,
      purchaseType: metadata.purchaseType,
      userId: metadata.userId,
      msg: 'Processing one-time payment checkout session completion',
    })

    // Delegate to purchase service for post-purchase processing
    try {
      await this.purchaseService.completeCheckoutSession(
        { checkoutSessionId: sessionId },
        prefetchedSession,
      )
    } catch (error) {
      // A BadRequestException here is a permanent content rejection (e.g.
      // Peerly refusing the script) — every Stripe redelivery would hit the
      // same wall, so acknowledge the webhook instead of retrying forever.
      // The idempotency marker was never stamped and the draft was reverted
      // to pending_payment, so the client-facing paths stay correct.
      if (error instanceof BadRequestException) {
        this.logger.error(
          { error },
          `[WEBHOOK] Checkout session fulfillment permanently rejected - Session: ${sessionId}, PurchaseType: ${metadata.purchaseType}`,
        )
        return
      }
      this.logger.error(
        { error },
        `[WEBHOOK] Failed to complete checkout session - Session: ${sessionId}, PurchaseType: ${metadata.purchaseType}`,
      )
      throw error
    }
  }

  async checkoutSessionExpiredHandler(
    event: Stripe.CheckoutSessionExpiredEvent,
  ): Promise<void> {
    const session = event.data.object
    const { id: sessionId } = session
    const { userId } = session.metadata ? session.metadata : {}
    if (!userId) {
      // A missing userId is permanent (dashboard-created or legacy session)
      // — throwing makes Stripe retry the webhook for days over pure cleanup.
      this.logger.warn(
        `[WEBHOOK] Expired checkout session ${sessionId} has no userId in metadata — skipping cleanup`,
      )
      return
    }

    // This event routinely arrives after a newer session id was stored
    // (creating a checkout expires its predecessor) — clearing
    // unconditionally would wipe the newer session's tracking and let it
    // escape future expiry. The swap is conditional on the stored id still
    // being the expired one; it also no-ops when the user doesn't exist in
    // this environment (e.g. a session minted against the shared test key).
    const cleared = await this.usersService.compareAndSwapCheckoutSessionId(
      parseInt(userId),
      sessionId,
      null,
    )
    if (!cleared) {
      this.logger.info(
        `[WEBHOOK] Skipped clearing checkoutSessionId for expired session ${sessionId} — user ${userId} missing or a newer session is stored`,
      )
    }
  }

  async customerSubscriptionDeletedHandler(
    event: Stripe.CustomerSubscriptionDeletedEvent,
  ): Promise<void> {
    const subscription = event.data.object
    const { id: subscriptionId } = subscription
    if (!subscriptionId) {
      throw 'No subscriptionId found in subscription'
    }

    const campaign =
      await this.campaignsService.findBySubscriptionId(subscriptionId)

    if (!campaign) {
      await this.reportUnmatchedSubscription(event)
      return
    }

    const user = await this.usersService.findUser({
      id: campaign.userId as number,
    })
    if (!user) {
      throw new InternalServerErrorException(
        `No user found with given campaign user id => ${campaign.userId}`,
      )
    }
    const { metaData } = user
    if (metaData?.isDeleted) {
      this.logger.info('User is already deleted')
      return
    }

    await this.campaignsService.persistCampaignProCancellation(campaign)
    await this.campaignsService.patchCampaignDetails(campaign.id, {
      subscriptionCanceledAt: Date.now(),
    })
    await this.sendProCancellationSlackMessage(user, campaign)
  }

  async sendProCancellationSlackMessage(user: User, campaign: Campaign) {
    const fullName = getUserFullName(user)
    const { organizationSlug, slug } = campaign
    const positionName = organizationSlug
      ? await this.organizationsService.resolvePositionNameByOrganizationSlug(
          organizationSlug,
        )
      : null

    await this.slackService.message(
      {
        text: `PRO PLAN CANCELLATION: \`${fullName}\` w/ email ${
          user.email
        }, running for '${positionName || 'Unknown Office'}' and campaign slug \`${
          slug
        }\` ended their pro subscription!`,
      },
      IS_PROD_DEPLOY ? SlackChannel.botPolitics : SlackChannel.botDev,
    )
  }

  async sendProSubscriptionResumedSlackMessage(user: User, campaign: Campaign) {
    await this.slackService.message(
      {
        text: `PRO PLAN RESUMED: \`${getUserFullName(user)}\` w/ email ${user.email} and campaign slug \`${campaign.slug}\` RESUMED their pro subscription!`,
      },
      IS_PROD_DEPLOY ? SlackChannel.botPolitics : SlackChannel.botDev,
    )
  }

  async sendProSignUpSlackMessage(user: User, campaign: Campaign) {
    const { details = {}, data = {}, organizationSlug, slug } = campaign
    const { state } = details
    const { hubspotId } = data
    const name = `${user.firstName}${user.firstName ? ` ${user.lastName}` : ''}`
    const positionName = organizationSlug
      ? await this.organizationsService.resolvePositionNameByOrganizationSlug(
          organizationSlug,
        )
      : null

    await this.slackService.message(
      {
        text: `PRO PLAN SIGN UP!!! :gp:\nName: ${name}\nEmail: ${user.email}\nCampaign slug: ${slug}\nState: ${state}\nOffice: ${positionName || 'Unknown Office'}\nAssigned PA: ${
          hubspotId
            ? await this.crm.getCrmCompanyOwnerName(hubspotId)
            : 'None assigned'
        }\n${
          hubspotId
            ? `https://app.hubspot.com/contacts/21589597/record/0-2/${hubspotId}`
            : 'No CRM company found'
        }`,
      },
      IS_PROD_DEPLOY ? SlackChannel.botPolitics : SlackChannel.botDev,
    )
  }
}
