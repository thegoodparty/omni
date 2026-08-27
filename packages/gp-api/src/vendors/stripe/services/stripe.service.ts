import {
  BadGatewayException,
  forwardRef,
  Inject,
  Injectable,
} from '@nestjs/common'
import { User } from '../../../generated/prisma'
import { PinoLogger } from 'nestjs-pino'
import { UsersService } from 'src/users/services/users.service'
import { WrapperType } from 'src/shared/types/utility.types'
import {
  CheckoutSessionMode,
  CustomCheckoutSessionPayload,
  PaymentIntentPayload,
  PaymentType,
  PurchaseIntentPayloadEntry,
} from 'src/payments/payments.types'
import { serializeError } from 'serialize-error'
import { SlackService } from 'src/vendors/slack/services/slack.service'
import Stripe from 'stripe'

import { requireEnv } from 'src/shared/util/env.util'

const STRIPE_SECRET_KEY = requireEnv('STRIPE_SECRET_KEY')
const WEBAPP_ROOT_URL = requireEnv('WEBAPP_ROOT_URL')
const STRIPE_WEBSOCKET_SECRET = requireEnv('STRIPE_WEBSOCKET_SECRET')

const LIVE_PRODUCT_ID = 'prod_QCGFVVUhD6q2Jo'
const TEST_PRODUCT_ID = 'prod_QAR4xrqUhyHHqX'

@Injectable()
export class StripeService {
  private stripe = new Stripe(STRIPE_SECRET_KEY)

  constructor(
    private readonly slack: SlackService,
    // Resolvable without StripeModule importing UsersModule because UsersModule
    // is @Global; forwardRef breaks the UsersService <-> StripeService cycle.
    @Inject(forwardRef(() => UsersService))
    private readonly usersService: WrapperType<UsersService>,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(StripeService.name)
  }

  // Returns the user's Stripe customerId, creating and persisting one the first
  // time. Concurrency-safe via a set-if-absent CAS: racing requests each create
  // a customer, but only one wins the CAS and persists its id; the losers drop
  // their now-orphan customer (no card attached) and return the stored winner,
  // so a card is never vaulted against an abandoned customer.
  async ensureCustomer(user: User): Promise<string> {
    const existingCustomerId = user.metaData?.customerId
    if (existingCustomerId) {
      return existingCustomerId
    }

    const name = [user.firstName, user.lastName]
      .filter(Boolean)
      .join(' ')
      .trim()

    let customer: Stripe.Customer
    try {
      customer = await this.stripe.customers.create({
        ...(user.email ? { email: user.email } : {}),
        ...(name ? { name } : {}),
        metadata: { userId: String(user.id) },
      })
    } catch (err) {
      this.logger.error({ err }, 'Failed to create Stripe customer')
      throw new BadGatewayException('Failed to create Stripe customer')
    }

    const won = await this.usersService.setCustomerIdIfAbsent(
      user.id,
      customer.id,
    )
    if (won) {
      return customer.id
    }

    // Lost the race: another request persisted a customerId first, so our
    // just-created customer is an orphan. Drop it best-effort — no card is
    // attached, and a cleanup failure must not fail a request that already has
    // a valid stored customerId.
    try {
      await this.stripe.customers.del(customer.id)
    } catch (err) {
      this.logger.error({ err }, 'Failed to delete orphan Stripe customer')
    }

    const winner = await this.usersService.findUser({ id: user.id })
    const winnerCustomerId = winner?.metaData?.customerId
    if (!winnerCustomerId) {
      throw new BadGatewayException(
        'Lost the customer-id race but found no stored customerId',
      )
    }
    return winnerCustomerId
  }

  // Off-session usage pre-authenticates the saved card so the later robocall
  // charge can run without the candidate present. Cards only: an off-session
  // vaulted bank debit would settle as ACH (delayed, returnable), breaking the
  // hold-then-capture model (mirrors createCustomCheckoutSession's pinning).
  async createSetupIntent(
    customerId: string,
  ): Promise<{ clientSecret: string }> {
    let setupIntent: Stripe.SetupIntent
    try {
      setupIntent = await this.stripe.setupIntents.create({
        customer: customerId,
        usage: 'off_session',
        payment_method_types: ['card'],
      })
    } catch (err) {
      this.logger.error({ err }, 'Failed to create Stripe setup intent')
      throw new BadGatewayException('Failed to create Stripe setup intent')
    }

    if (!setupIntent.client_secret) {
      throw new BadGatewayException(
        'Failed to create setup intent: no client_secret returned',
      )
    }

    return { clientSecret: setupIntent.client_secret }
  }

  private getPrice = async () => {
    const { default_price: price } = await this.stripe.products.retrieve(
      STRIPE_SECRET_KEY?.includes('live') ? LIVE_PRODUCT_ID : TEST_PRODUCT_ID,
    )
    return price
  }

  async createPaymentIntent<T extends PaymentType>(
    user: User,
    { amount, description, type, ...restMetadata }: PaymentIntentPayload<T>,
  ) {
    const userId = user.id
    const customerId = user.metaData?.customerId

    const cleanedMetadata = Object.entries(restMetadata)
      .filter(
        ([_, value]: [string, PurchaseIntentPayloadEntry]) => value != null,
      )
      .reduce(
        (acc, [key, value]: [string, PurchaseIntentPayloadEntry]) => ({
          ...acc,
          [key]: value,
        }),
        {},
      )

    return await this.stripe.paymentIntents.create({
      customer: customerId,
      amount: Math.floor(amount), // Stripe expects an integer of cents
      currency: 'usd',
      description,
      automatic_payment_methods: {
        enabled: true,
      },
      metadata: {
        ...(cleanedMetadata as Record<string, string | number>),
        userId,
        paymentType: type,
      },
    })
  }

  async retrievePaymentIntent(paymentId: string) {
    return await this.stripe.paymentIntents.retrieve(paymentId)
  }

  async updatePaymentIntentMetadata(
    paymentIntentId: string,
    metadata: Record<string, string>,
  ) {
    return await this.stripe.paymentIntents.update(paymentIntentId, {
      metadata,
    })
  }

  // Full refund of a completed one-time payment (cancel-before-send).
  // Callers pass a stable idempotency key so a retried cancel can never
  // refund twice.
  async refundPaymentIntent(paymentIntentId: string, idempotencyKey: string) {
    return await this.stripe.refunds.create(
      { payment_intent: paymentIntentId },
      { idempotencyKey },
    )
  }

  async retrieveCheckoutSession(sessionId: string) {
    return await this.stripe.checkout.sessions.retrieve(sessionId)
  }

  // Receipt read: card brand/last4 and the hosted receipt URL live on the
  // payment intent's latest charge, which plain retrieve leaves as an id.
  async retrieveCheckoutSessionWithCharge(sessionId: string) {
    return await this.stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['payment_intent.latest_charge'],
    })
  }

  // Returns the session's terminal disposition: a completed session means a
  //  payment already went through, which callers must treat differently from
  //  an expired one — the paid session's fulfillment may still be in flight,
  //  so it must block a new checkout rather than clear the way for one.
  async expireCheckoutSession(
    checkoutSessionId: string,
  ): Promise<'expired' | 'complete'> {
    try {
      await this.stripe.checkout.sessions.expire(checkoutSessionId)
      return 'expired'
    } catch (error) {
      if (!(error instanceof Stripe.errors.StripeInvalidRequestError)) {
        this.logger.error(
          { error: serializeError(error), checkoutSessionId },
          'Failed to expire checkout session',
        )
        throw new BadGatewayException(
          `Failed to expire checkout session ${checkoutSessionId}`,
        )
      }
    }

    // Expire raises StripeInvalidRequestError only when the session is not
    //  open: it completed, already expired, or does not exist on this
    //  environment's Stripe key. Retrieve to tell which.
    try {
      const session =
        await this.stripe.checkout.sessions.retrieve(checkoutSessionId)
      return session.status === 'complete' ? 'complete' : 'expired'
    } catch (error) {
      if (error instanceof Stripe.errors.StripeInvalidRequestError) {
        this.logger.info(
          { checkoutSessionId },
          'Previous checkout session not found, skipping expiry',
        )
        return 'expired'
      }
      this.logger.error(
        { error: serializeError(error), checkoutSessionId },
        'Failed to retrieve checkout session after expiry conflict',
      )
      throw new BadGatewayException(
        `Failed to expire checkout session ${checkoutSessionId}`,
      )
    }
  }

  // Shared params for the Pro subscription Checkout Session, used by both the
  //  redirect flow (createCheckoutSession) and the embedded flow
  //  (createEmbeddedProSubscriptionCheckoutSession). The webhook
  //  (checkout.session.completed) identifies the campaign and sets isPro from
  //  metadata.userId, so both flows must carry it identically.
  private getProSubscriptionSessionParams = async (
    userId: number,
    email: string | null,
  ): Promise<Stripe.Checkout.SessionCreateParams> => ({
    metadata: {
      userId,
    },
    ...(email ? { customer_email: email } : {}),
    billing_address_collection: 'auto',
    line_items: [
      {
        // We should never have more than 1 price for Pro. But if we do, this
        //  will need to be more intelligent.
        // Stripe SDK uses broad union types — default_price is string | Price | null
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        price: (await this.getPrice()) as string,
        quantity: 1,
      },
    ],
    mode: CheckoutSessionMode.SUBSCRIPTION,
    allow_promotion_codes: true,
    // Expanding for Segment / analytics
    expand: [
      'subscription',
      'subscription.items.data.price',
      'payment_intent.payment_method',
    ],
  })

  async createCheckoutSession(userId: number, email: string | null = null) {
    const session = await this.stripe.checkout.sessions.create({
      ...(await this.getProSubscriptionSessionParams(userId, email)),
      success_url: `${WEBAPP_ROOT_URL}/dashboard/pro-upgrade/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${WEBAPP_ROOT_URL}/dashboard`,
    })

    const { url: redirectUrl, id: checkoutSessionId } = session
    return { redirectUrl, checkoutSessionId }
  }

  // Embedded (in-wizard) variant of the Pro subscription checkout. Mirrors the
  //  one-time embedded path (createCustomCheckoutSession): ui_mode 'custom' +
  //  return_url, returns a client_secret instead of a redirect url. isPro is
  //  still flipped only by the checkout.session.completed webhook.
  async createEmbeddedProSubscriptionCheckoutSession(
    userId: number,
    email: string | null = null,
    returnUrl: string = `${WEBAPP_ROOT_URL}/dashboard/pro-upgrade?session_id={CHECKOUT_SESSION_ID}`,
  ) {
    const session = await this.stripe.checkout.sessions.create({
      ...(await this.getProSubscriptionSessionParams(userId, email)),
      ui_mode: 'custom',
      return_url: returnUrl,
    })

    if (!session.client_secret) {
      throw new BadGatewayException(
        'Failed to create checkout session: no client_secret returned',
      )
    }

    return {
      clientSecret: session.client_secret,
      checkoutSessionId: session.id,
    }
  }

  async createCustomCheckoutSession(
    {
      id: userId,
      email,
      customerId,
    }: Pick<User, 'id' | 'email'> &
      Pick<NonNullable<User['metaData']>, 'customerId'>,
    payload: CustomCheckoutSessionPayload,
  ): Promise<{
    id: string
    clientSecret: string
    amount: number
  }> {
    const cleanedMetadata = Object.entries(payload.metadata || {})
      .filter(([_, value]) => value != null)
      .reduce(
        (acc, [key, value]) => ({
          ...acc,
          [key]: String(value),
        }),
        {},
      )

    const session = await this.stripe.checkout.sessions.create({
      ui_mode: 'custom',
      mode: 'payment',
      // Explicit list: Stripe's automatic set adds BNPL options (Klarna,
      // Affirm) that are off-brand for campaign charges (product call,
      // Aug 19). Card, bank debit, and Amazon Pay stay.
      payment_method_types: ['card', 'us_bank_account', 'amazon_pay'],
      ...(customerId
        ? { customer: customerId }
        : email
          ? { customer_email: email }
          : {}),
      ...(email ? { payment_intent_data: { receipt_email: email } } : {}),
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: payload.productName,
              ...(payload.productDescription
                ? { description: payload.productDescription }
                : {}),
            },
            unit_amount: Math.floor(payload.amount), // Stripe expects cents as integer
          },
          quantity: 1,
        },
      ],
      ...(payload.allowPromoCodes ? { allow_promotion_codes: true } : {}),
      return_url: payload.returnUrl,
      metadata: {
        ...cleanedMetadata,
        userId: String(userId),
        paymentType: payload.type,
        purchaseType: payload.purchaseType,
      },
    })

    if (!session.client_secret) {
      throw new BadGatewayException(
        'Failed to create checkout session: no client_secret returned',
      )
    }

    return {
      id: session.id,
      clientSecret: session.client_secret,
      amount:
        session.amount_total != null
          ? session.amount_total / 100
          : payload.amount / 100,
    }
  }

  async createPortalSession(customerId: string) {
    return await this.stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${WEBAPP_ROOT_URL}/profile`,
    })
  }

  async parseWebhookEvent(rawBody: Buffer, stripeSignature: string) {
    return this.stripe.webhooks.constructEvent(
      rawBody,
      stripeSignature,
      STRIPE_WEBSOCKET_SECRET,
    )
  }

  async fetchCustomerIdFromCheckoutSession(
    checkoutSessionId: string,
  ): Promise<string | null> {
    let checkoutSession: Stripe.Checkout.Session
    try {
      checkoutSession =
        await this.stripe.checkout.sessions.retrieve(checkoutSessionId)
    } catch (error) {
      this.logger.error(
        { error },
        `Failed to retrieve checkout session ${checkoutSessionId}`,
      )
      throw new BadGatewayException(
        'Failed to retrieve checkout session from Stripe',
      )
    }

    if (checkoutSession.payment_status !== 'paid') {
      this.logger.warn(
        `Checkout session ${checkoutSessionId} has status: ${checkoutSession.payment_status}`,
      )
      return null
    }

    const { customer } = checkoutSession

    if (!customer) {
      return null
    }

    if (typeof customer === 'string') {
      return customer
    }

    return customer.id
  }

  async retrieveSubscription(subscriptionId: string) {
    try {
      return await this.stripe.subscriptions.retrieve(subscriptionId)
    } catch (e) {
      if (e instanceof Error) {
        this.logger.error(
          e,
          `Failed to retrieve subscription ${subscriptionId}`,
        )
        throw new BadGatewayException(
          `Failed to retrieve subscription ${subscriptionId}`,
          e.message,
        )
      }
      throw e
    }
  }

  async cancelSubscription(subscriptionId: string) {
    try {
      return await this.stripe.subscriptions.cancel(subscriptionId)
    } catch (e) {
      if (e instanceof Error) {
        this.logger.error(e, `Failed to cancel subscription ${subscriptionId}`)
        await this.slack.errorMessage({
          message: 'Error canceling subscription',
          error: { subscriptionId, error: e },
        })
        throw new BadGatewayException(
          `Failed to cancel subscription ${subscriptionId}`,
          { cause: e },
        )
      }
      throw e
    }
  }
}
