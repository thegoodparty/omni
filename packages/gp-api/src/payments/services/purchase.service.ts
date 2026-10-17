import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common'
import { Campaign, User } from '../../generated/prisma'
import {
  CheckoutSessionPaymentFailedHandler,
  CheckoutSessionPostPurchaseHandler,
  CompleteCheckoutSessionDto,
  CompleteFreePurchaseDto,
  CreateCheckoutSessionDto,
  PurchaseHandler,
  PurchaseType,
} from '../purchase.types'
import { CustomCheckoutSessionPayload, PaymentType } from '../payments.types'
import { StripeService } from 'src/vendors/stripe/services/stripe.service'
import { PinoLogger } from 'nestjs-pino'
import { WIN_SMS_HOLD_BILLING_FLAG } from 'src/shared/util/winSmsHold.util'
import { FeaturesService } from '@/features/services/features.service'
import Stripe from 'stripe'

const { WEBAPP_ROOT_URL } = process.env

@Injectable()
export class PurchaseService {
  // TODO: Refactor to remove the "handlers" anti-pattern here along w/
  //  implementors of the anti-pattern elsewhere.
  //  It's absolutely over-engineered, causes confusion and obfuscation in the
  //  code, and makes it very difficult to create type-safe annotations w/o
  //  having to resort to `any` or `unknown` escape hatches.
  //  It also tightly couples the purchasing logic flows, with the logic flows of
  //  _what_ is being purchased and _how_ it is being purchased:
  //  https://app.clickup.com/t/90132012119/ENG-4065
  private handlers: Map<PurchaseType, PurchaseHandler<unknown>> = new Map()
  private checkoutSessionPostPurchaseHandlers: Map<
    PurchaseType,
    CheckoutSessionPostPurchaseHandler<unknown>
  > = new Map()
  private checkoutSessionPaymentFailedHandlers: Map<
    PurchaseType,
    CheckoutSessionPaymentFailedHandler<unknown>
  > = new Map()

  constructor(
    private readonly stripeService: StripeService,
    private readonly logger: PinoLogger,
    private readonly features: FeaturesService,
  ) {
    this.logger.setContext('PurchaseService')
  }

  // ENTRY: the Win p2p SMS hold-billing decision, evaluated ONCE per checkout
  // request for the resolved user and reused for both the Stripe session's
  // capture mode and the handler's amount calculation — so the two can never
  // disagree within one request. Scoped to TEXT + p2p so every other purchase
  // type never pays the Amplitude round-trip. Downstream (the webhook that
  // records the hold, capture, and the reconcile sweeps) never calls this —
  // they key on durable state (the PI's capture_method, or the
  // OutreachP2pSms satellite) instead, so a flag flip after this point can
  // never strand or unsettle a hold already placed.
  private async resolveWinSmsHoldBillingEnabled(
    user: User,
    purchaseType: PurchaseType,
    metadata: { outreachType?: string } | null | undefined,
  ): Promise<boolean> {
    if (
      purchaseType !== PurchaseType.TEXT ||
      metadata?.outreachType !== 'p2p'
    ) {
      return false
    }
    return this.features.isFeatureEnabled({
      user,
      feature: WIN_SMS_HOLD_BILLING_FLAG,
    })
  }

  registerPurchaseHandler(
    type: PurchaseType,
    handler: PurchaseHandler<unknown>,
  ): void {
    this.handlers.set(type, handler)
  }

  registerCheckoutSessionPostPurchaseHandler(
    type: PurchaseType,
    handler: CheckoutSessionPostPurchaseHandler<unknown>,
  ): void {
    this.checkoutSessionPostPurchaseHandlers.set(type, handler)
  }

  registerCheckoutSessionPaymentFailedHandler(
    type: PurchaseType,
    handler: CheckoutSessionPaymentFailedHandler<unknown>,
  ): void {
    this.checkoutSessionPaymentFailedHandlers.set(type, handler)
  }

  /**
   * Creates a Custom Checkout Session for one-time payments with promo code support.
   * This is the new preferred method for purchases that should support promo codes.
   *
   * Migration reference: https://docs.stripe.com/payments/payment-element/migration-ewcs
   */
  async createCheckoutSession({
    user,
    dto,
    metadata,
  }: {
    user: User
    dto: CreateCheckoutSessionDto<unknown>
    metadata: {
      campaignId?: number
      organizationSlug?: string
    }
  }): Promise<{
    id: string
    clientSecret: string
    amount: number
  }> {
    this.logger.info({
      user: user.id,
      dto,
      metadata,
      msg: 'Attempting checkout session creation for user',
    })

    if (!Object.values(PurchaseType).includes(dto.type)) {
      throw new Error(`Invalid purchase type: ${dto.type}`)
    }

    const handler = this.handlers.get(dto.type)
    if (!handler) {
      throw new Error(`No handler found for purchase type: ${dto.type}`)
    }

    // Validate the purchase (checks for existing payments, etc.)
    // For domains, validatePurchase returns an existing succeeded PaymentIntent
    // if the domain was already purchased. In the legacy createPurchaseIntent flow
    // this PI is reused. For checkout sessions we must reject the duplicate to
    // prevent charging the user twice for the same purchase.
    const existingPayment = await handler.validatePurchase({
      // Stripe SDK uses broad union types — metadata and IDs are string | null | Stripe.* unions
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      ...(dto.metadata as Record<string, unknown>),
      ...metadata,
    })

    if (existingPayment) {
      throw new Error(
        'This purchase has already been completed. Please refresh the page.',
      )
    }

    // ENTRY: evaluate the Win SMS hold-billing flag ONCE here, for the
    // resolved request user, before amount calculation and session creation —
    // both read this SAME value (never the flag directly), so they can never
    // disagree within this request. See resolveWinSmsHoldBillingEnabled.
    const winSmsHoldBillingEnabled = await this.resolveWinSmsHoldBillingEnabled(
      user,
      dto.type,
      // dto's generic Metadata is unknown at this call site (CreateCheckoutSessionDto<unknown>);
      // the handler-specific shape is validated downstream by each PurchaseHandler.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      dto.metadata as { outreachType?: string } | null | undefined,
    )

    // Merge server-side campaignId into metadata for calculateAmount.
    // Handlers like outreach need campaignId to check free texts eligibility.
    // We must use the server-validated campaign, not trust the client's campaignId.
    const mergedMetadata = {
      // Stripe SDK uses broad union types — metadata and IDs are string | null | Stripe.* unions
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      ...(dto.metadata as Record<string, unknown>),
      ...metadata,
      winSmsHoldBillingEnabled,
    }

    const amount = await handler.calculateAmount(mergedMetadata)

    // Handle zero-amount purchases (e.g., free texts offer covers entire purchase)
    // Stripe doesn't need a real Checkout Session for $0
    // Do NOT execute post-purchase handlers here — the user hasn't confirmed yet.
    // Post-purchase (e.g., redeeming free texts) is deferred to completeFreePurchase(),
    // which the frontend calls when the user explicitly clicks "Schedule text".
    if (amount === 0) {
      const freeSessionId = `free_${Date.now()}_${user.id}`

      this.logger.info(
        `Zero-amount checkout for user ${user.id}, type ${dto.type} - skipping Stripe, deferring post-purchase until user confirmation`,
      )

      return {
        id: freeSessionId,
        clientSecret: '',
        amount: 0,
      }
    }

    const productName = handler.getProductName
      ? handler.getProductName(dto.metadata)
      : this.getDefaultProductName(dto.type)
    const productDescription = handler.getProductDescription
      ? handler.getProductDescription(dto.metadata)
      : undefined

    const returnUrl =
      dto.returnUrl ||
      `${WEBAPP_ROOT_URL}/dashboard/purchase/complete?session_id={CHECKOUT_SESSION_ID}`

    // Win p2p SMS hold billing: a p2p text checkout authorizes a manual-capture
    // hold instead of charging immediately — reusing the SAME flag value
    // resolved above (already scoped to TEXT + p2p), never a second read, so
    // this can never disagree with what calculateAmount just billed. `amount`
    // is already the UNDISCOUNTED hold (the handler skips the free-texts
    // discount when this is on), so the later capture can never exceed it.
    const manualCapture = winSmsHoldBillingEnabled

    const checkoutPayload: CustomCheckoutSessionPayload = {
      type: this.getPaymentType(dto.type),
      purchaseType: dto.type,
      amount,
      productName,
      productDescription,
      // A hold checkout takes promo codes too. Stripe takes the discount off
      // the hold itself, and recordHold stamps it from the completed session
      // (OutreachP2pSms.promoDiscountInCents) so capture takes it off the
      // final count as well. A code that covers the whole hold completes the
      // session with no PaymentIntent at all, which recordHold records as a
      // covered send.
      allowPromoCodes: true,
      returnUrl,
      manualCapture,
      metadata: {
        // Stripe SDK uses broad union types — metadata and IDs are string | null | Stripe.* unions
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        ...(dto.metadata as Record<string, unknown>),
        ...metadata,
        // The hold decision, stamped server-side so the webhook can tell a
        // hold checkout a promo code covered in full (no PaymentIntent, so no
        // capture_method to read) from an immediate one. Undefined drops any
        // client-sent value, since the session metadata starts from dto's.
        winSmsHoldBilling: manualCapture ? 'true' : undefined,
      },
    }

    return this.stripeService.createCustomCheckoutSession(
      {
        id: user.id,
        email: user.email,
        customerId: user.metaData?.customerId,
      },
      checkoutPayload,
    )
  }

  /**
   * Completes a purchase made via Checkout Session.
   * Called after the user completes payment and is redirected back.
   *
   * This method is idempotent - if called multiple times (e.g., from both
   * webhook and client), the post-purchase handler will only run once.
   * Uses PaymentIntent metadata to track completion status.
   *
   * NOTE: There is a small race window between the idempotency check and
   * the metadata write. If concurrent calls (webhook + client) both pass
   * the check before either writes the flag, both may execute the handler.
   * To fully prevent this, handlers should implement their own idempotency
   * (e.g., checking for existing records before creating). A database-based
   * lock using a unique purchase record would eliminate this window entirely.
   */
  async completeCheckoutSession(
    dto: CompleteCheckoutSessionDto,
    // Callers with an already-confirmed session (the async_payment_succeeded
    // webhook payload) pass it here so we don't re-fetch. The Stripe API object
    // is only eventually consistent with the webhook, so a re-fetch could still
    // read payment_status 'unpaid' and silently defer — dropping fulfillment.
    prefetchedSession?: Stripe.Checkout.Session,
  ): Promise<{
    alreadyProcessed: boolean
    deferred?: boolean
    result?: unknown
  }> {
    const session =
      prefetchedSession ??
      (await this.stripeService.retrieveCheckoutSession(dto.checkoutSessionId))

    if (session.status !== 'complete') {
      throw new Error(`Checkout session not completed: ${session.status}`)
    }

    // Do not deliver value until the payment is actually confirmed. For
    // delayed-notification methods (e.g. ACH bank debit) Stripe fires
    // checkout.session.completed with payment_status still 'unpaid'; the funds
    // settle later and emit checkout.session.async_payment_succeeded, which
    // re-invokes this handler with payment_status 'paid'. A session a
    // promotion code covered in full reads 'paid' (or 'no_payment_required')
    // with no PaymentIntent: nothing settles later, so it is fulfilled now
    // (Stripe's own rule is "fulfill unless unpaid"). With no PaymentIntent
    // the marker below is skipped and the handlers' own claims are the only
    // guard.
    if (session.payment_status === 'unpaid') {
      // A Win SMS hold-billing checkout authorizes a manual-capture hold, which
      // completes the session 'unpaid' because the funds are HELD, not captured
      // — NOT the ACH "settles later" case the deferral below exists for.
      // Detected off the live PI's capture_method (set once, at session
      // creation, and never re-read from a flag here) rather than the
      // win_sms_hold_billing flag: a flag flip between session-creation and
      // this webhook must never make an already-placed hold fall through to
      // the ACH deferral, which would strand it forever (a manual-capture hold
      // has no async_payment_succeeded follow-up to ever retrigger it).
      //
      // Scoped to TEXT by TYPE, not by flag: manualCapture is only ever set
      // for PurchaseType.TEXT (createCheckoutSession), so no other purchase
      // type can ever carry a manual-capture PI. Checking first avoids an
      // extra live Stripe read (and a new failure mode — a transient read
      // error now throwing instead of deferring) on every ACH-paid domain/
      // poll/pro-plan purchase, which can never be a hold.
      const paymentIntent =
        session.metadata?.purchaseType === PurchaseType.TEXT
          ? await this.resolveSessionPaymentIntent(session)
          : null
      if (paymentIntent?.capture_method === 'manual') {
        // Once the PI is authorized (requires_capture) fulfill now; while it is
        // still the transient not-yet-authorized state, THROW so
        // checkout.session.completed redelivers. The authorization is
        // synchronous at checkout, so a redelivery resolves it; a genuinely
        // never-authorized session just exhausts Stripe's bounded retries and
        // the hold auto-releases (no money taken). A plain Error (not a
        // BadRequestException) is what the webhook handler treats as retryable
        // rather than a permanent content rejection it would ack.
        if (paymentIntent.status !== 'requires_capture') {
          throw new Error(
            `Win SMS hold not yet authorized for checkout session ` +
              `${dto.checkoutSessionId}; forcing webhook redelivery`,
          )
        }
        // requires_capture: a usable hold — fall through to fulfillment.
      } else {
        this.logger.info({
          sessionId: dto.checkoutSessionId,
          paymentStatus: session.payment_status,
          msg: 'Checkout session payment not confirmed — deferring fulfillment',
        })
        // `deferred` distinguishes this not-yet-paid case from a completed
        // fulfillment (which also returns alreadyProcessed: false) so callers —
        // e.g. the client redirect handler — can show a pending state instead
        // of success.
        return { alreadyProcessed: false, deferred: true }
      }
    }

    // Stripe SDK uses broad union types — metadata and IDs are string | null | Stripe.* unions
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const purchaseType = session.metadata?.purchaseType as PurchaseType
    if (!purchaseType) {
      throw new Error('No purchase type found in session metadata')
    }

    // Check idempotency: verify if post-purchase was already processed
    // Stripe SDK uses broad union types — cannot narrow without runtime expandable-field check
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const paymentIntentId = session.payment_intent as string
    if (paymentIntentId) {
      const paymentIntent =
        await this.stripeService.retrievePaymentIntent(paymentIntentId)
      if (paymentIntent.metadata?.postPurchaseCompletedAt) {
        this.logger.info({
          sessionId: dto.checkoutSessionId,
          paymentIntentId,
          completedAt: paymentIntent.metadata.postPurchaseCompletedAt,
          msg: 'Post-purchase already processed, skipping (idempotent)',
        })
        return { alreadyProcessed: true }
      }
    }

    const postPurchaseHandler =
      this.checkoutSessionPostPurchaseHandlers.get(purchaseType)
    if (!postPurchaseHandler) {
      throw new Error(
        'No checkout session post-purchase handler found for this purchase type',
      )
    }

    const result = await postPurchaseHandler(
      dto.checkoutSessionId,
      session.metadata,
    )

    // Mark as processed AFTER handler succeeds to allow retries on failure
    if (paymentIntentId) {
      await this.stripeService.updatePaymentIntentMetadata(paymentIntentId, {
        postPurchaseCompletedAt: new Date().toISOString(),
      })
    }

    return { alreadyProcessed: false, result }
  }

  // Re-reads the live PaymentIntent behind a checkout session — the
  // authoritative money state, not the session's cached payment_status —
  // so a completed-but-'unpaid' session's capture_method and status can be
  // read durably. Null when the session carries no PaymentIntent.
  private async resolveSessionPaymentIntent(
    session: Stripe.Checkout.Session,
  ): Promise<Stripe.PaymentIntent | null> {
    const paymentIntentId =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id
    if (!paymentIntentId) return null
    return this.stripeService.retrievePaymentIntent(paymentIntentId)
  }

  // The counterpart of the deferral in completeCheckoutSession: a
  // delayed-notification payment that completed checkout 'unpaid' has now
  // failed to settle, so the fulfillment it deferred will never run and the
  // purchase type gets to unwind whatever it parked at checkout.
  async failCheckoutSession(session: Stripe.Checkout.Session): Promise<void> {
    // Stripe SDK uses broad union types — metadata values are plain strings
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const purchaseType = session.metadata?.purchaseType as
      | PurchaseType
      | undefined
    const handler = purchaseType
      ? this.checkoutSessionPaymentFailedHandlers.get(purchaseType)
      : undefined
    if (!handler) {
      this.logger.warn(
        { sessionId: session.id, purchaseType },
        'No payment-failed handler for this purchase type; nothing to unwind',
      )
      return
    }
    await handler(session.id, session.metadata)
  }

  private getDefaultProductName(purchaseType: PurchaseType): string {
    switch (purchaseType) {
      case PurchaseType.DOMAIN_REGISTRATION:
        return 'Domain Registration'
      case PurchaseType.TEXT:
        return 'SMS Outreach'
      default:
        return 'Purchase'
    }
  }

  /**
   * Completes a zero-amount (free) purchase by executing the post-purchase handler.
   * This is called when the user explicitly confirms a free purchase (e.g., clicks
   * "Schedule text" after the free texts offer covers the entire cost).
   *
   * The post-purchase handler is idempotent — redeemFreeTexts uses an atomic
   * updateMany with hasFreeTextsOffer: true as a guard, so duplicate calls are safe.
   */
  async completeFreePurchase({
    dto,
    campaign,
    user,
  }: {
    dto: CompleteFreePurchaseDto
    campaign?: Campaign
    user: User
    // TODO: Replace `unknown` with discriminated union return type
    //  https://app.clickup.com/t/90132012119/ENG-6654
  }): Promise<{ result?: unknown }> {
    const { purchaseType } = dto

    if (!Object.values(PurchaseType).includes(purchaseType)) {
      throw new BadRequestException(`Invalid purchase type: ${purchaseType}`)
    }

    const purchaseHandler = this.handlers.get(purchaseType)
    if (!purchaseHandler) {
      throw new InternalServerErrorException(
        `No handler found for purchase type: ${purchaseType}`,
      )
    }

    const postPurchaseHandler =
      this.checkoutSessionPostPurchaseHandlers.get(purchaseType)
    if (!postPurchaseHandler) {
      throw new InternalServerErrorException(
        `No checkout session post-purchase handler found for purchase type: ${purchaseType}`,
      )
    }

    // ENTRY: same single evaluation as createCheckoutSession, for the user
    // confirming this free purchase — a $0 p2p hold-model send still needs
    // the SAME flag value calculateAmount used to confirm the amount is
    // really zero (see outreachPurchase.service.ts's forgiveness floor).
    const winSmsHoldBillingEnabled = await this.resolveWinSmsHoldBillingEnabled(
      user,
      purchaseType,
      // FreePurchaseMetadata is a union of handler-specific shapes; only the
      // outreach branch carries outreachType, validated downstream per handler.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      dto.metadata as { outreachType?: string },
    )

    const mergedMetadata = {
      ...dto.metadata,
      ...(campaign?.id ? { campaignId: campaign.id } : {}),
      userId: String(user.id),
      winSmsHoldBillingEnabled,
    }

    const existingPayment =
      await purchaseHandler.validatePurchase(mergedMetadata)
    if (existingPayment) {
      throw new ConflictException(
        'This purchase has already been completed. Please refresh the page.',
      )
    }

    const amount = await purchaseHandler.calculateAmount(mergedMetadata)
    if (amount !== 0) {
      throw new BadRequestException(
        `Free purchase completion is only allowed for zero-amount purchases. Calculated amount: ${amount}`,
      )
    }

    const freeSessionId = `free_confirmed_${Date.now()}`
    const result = await postPurchaseHandler(freeSessionId, {
      ...mergedMetadata,
      purchaseType,
    })

    this.logger.info(
      `Free purchase completed for type ${purchaseType}, campaign ${campaign?.id}`,
    )

    return { result }
  }

  private getPaymentType(purchaseType: PurchaseType): PaymentType {
    switch (purchaseType) {
      case PurchaseType.DOMAIN_REGISTRATION:
        return PaymentType.DOMAIN_REGISTRATION
      case PurchaseType.TEXT:
        return PaymentType.OUTREACH_PURCHASE
      // A Serve SMS send is still an outreach purchase on the payment side —
      // only the handler differs (a Serve row has no campaign and no Peerly
      // identity). Missing this line is not a missing feature: the default
      // branch below THROWS, so checkout 500s with an error that names the
      // payment-type map rather than anything about Serve SMS.
      case PurchaseType.SERVE_TEXT:
        return PaymentType.OUTREACH_PURCHASE
      default:
        throw new Error(`No payment type mapping for: ${purchaseType}`)
    }
  }
}
