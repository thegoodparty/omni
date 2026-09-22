import type { OutreachPurchaseMetadata } from '../outreach/types/outreach.types'
import type { DomainPurchaseMetadata } from '../websites/domains.types'
import Stripe from 'stripe'
export enum PurchaseType {
  DOMAIN_REGISTRATION = 'DOMAIN_REGISTRATION',
  TEXT = 'TEXT',
  // A Serve SMS send: an elected official texting their constituents. A
  // separate type from TEXT because the TEXT handler is structurally Win-only
  // — it returns early unless a campaignId is present and
  // `outreachType === 'p2p'`, and it finalizes to Peerly, which a Serve row
  // has no identity for. See outreach/services/outreachServeSmsPurchase
  // .service.ts and docs/features/serve-sms.md, "Layer 2: SMS (Serve)".
  SERVE_TEXT = 'SERVE_TEXT',
  POLL = 'POLL',
}

export interface BasePurchaseMetadata {
  campaignId?: number
}

export interface CreateCheckoutSessionDto<Metadata> {
  type: PurchaseType
  metadata: Metadata
  returnUrl?: string
}

export interface CompleteCheckoutSessionDto {
  checkoutSessionId: string
}

export interface CreateProCheckoutSessionDto {
  // When true, returns a client_secret for an in-wizard embedded checkout
  //  instead of a redirect url. isPro is still flipped only by the
  //  checkout.session.completed webhook regardless of this flag.
  embedded?: boolean
  returnUrl?: string
}

export type FreePurchaseMetadata =
  | OutreachPurchaseMetadata
  | DomainPurchaseMetadata
  | BasePurchaseMetadata

export interface CompleteFreePurchaseDto {
  purchaseType: PurchaseType
  metadata: FreePurchaseMetadata
}

export type CheckoutSessionPostPurchaseHandler<Metadata> = (
  sessionId: string,
  metadata: Metadata,
) => Promise<unknown>

export type CheckoutSessionPaymentFailedHandler<Metadata> = (
  sessionId: string,
  metadata: Metadata,
) => Promise<void>

export interface PurchaseHandler<Metadata> {
  validatePurchase(metadata: Metadata): Promise<void | Stripe.PaymentIntent>
  calculateAmount(metadata: Metadata): Promise<number>
  getProductName?(metadata: Metadata): string
  getProductDescription?(metadata: Metadata): string | undefined
}
