import { PurchaseType } from '@/payments/purchase.types'
export const WebhookEventType = {
  CheckoutSessionCompleted: 'checkout.session.completed',
  CheckoutSessionAsyncPaymentSucceeded:
    'checkout.session.async_payment_succeeded',
  CheckoutSessionExpired: 'checkout.session.expired',
  CustomerSubscriptionCreated: 'customer.subscription.created',
  CustomerSubscriptionDeleted: 'customer.subscription.deleted',
  CustomerSubscriptionUpdated: 'customer.subscription.updated',
  CustomerSubscriptionResumed: 'customer.subscription.resumed',
  // Stripe exposes event types only as string-literal discriminants on its
  // event interfaces (Stripe.PaymentMethodDetachedEvent /
  // Stripe.ChargeDisputeCreatedEvent), not as named constants — these mirror
  // those literals so the dispatch switch narrows to the right event type.
  PaymentMethodDetached: 'payment_method.detached',
  ChargeDisputeCreated: 'charge.dispute.created',
} as const

export const CheckoutSessionMode = {
  PAYMENT: 'payment',
  SUBSCRIPTION: 'subscription',
} as const

export enum PaymentStatus {
  REQUIRES_PAYMENT_METHOD = 'requires_payment_method',
  REQUIRES_CONFIRMATION = 'requires_confirmation',
  REQUIRES_ACTION = 'requires_action',
  PROCESSING = 'processing',
  REQUIRES_CAPTURE = 'requires_capture',
  CANCELED = 'canceled',
  SUCCEEDED = 'succeeded',
}

export enum PaymentType {
  DOMAIN_REGISTRATION = 'domain_registration',
  OUTREACH_PURCHASE = 'outreach_purchase',
  POLL = 'poll',
}

export interface CustomCheckoutSessionPayload {
  type: PaymentType
  purchaseType: PurchaseType
  amount: number
  productName: string
  productDescription?: string
  allowPromoCodes?: boolean
  returnUrl: string
  metadata?: Record<string, string | number | undefined>
}

export type PaymentIntentPayload<T extends PaymentType> = {
  type: T
  amount: number
  description?: string
  purchaseType: PurchaseType
} & (T extends PaymentType.DOMAIN_REGISTRATION
  ? {
      domainName: string
      domainId?: number
    }
  : T extends PaymentType.POLL
    ? {
        count: number
        pollId: number
      }
    : never)

export type PurchaseIntentPayloadEntry = PurchaseType | string | number
