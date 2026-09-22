// Hand-rolled mirror of gp-api's PurchaseType enum
// (`src/payments/purchase.types.ts`); keep the two in step.
export const PURCHASE_TYPES = {
  DOMAIN_REGISTRATION: 'DOMAIN_REGISTRATION',
  TEXT: 'TEXT',
  POLL: 'POLL',
  // Serve SMS. A separate type rather than a scope flag on TEXT because the
  // TEXT handler returns early without a campaignId and finalizes the send
  // to Peerly, neither of which an elected official's org has.
  SERVE_TEXT: 'SERVE_TEXT',
} as const

export type PurchaseType = (typeof PURCHASE_TYPES)[keyof typeof PURCHASE_TYPES]

export const PURCHASE_TYPE_LABELS: Record<PurchaseType, string> = {
  [PURCHASE_TYPES.DOMAIN_REGISTRATION]: 'Domain Registration',
  [PURCHASE_TYPES.POLL]: 'SMS Poll Payment',
  // Empty for the same reason TEXT is: both are paid from inside the SMS
  // flow's own review step, which writes its own summary. Neither ever
  // reaches the standalone /dashboard/purchase page these records feed.
  [PURCHASE_TYPES.TEXT]: '',
  [PURCHASE_TYPES.SERVE_TEXT]: '',
}

export const PURCHASE_TYPE_DESCRIPTIONS: Record<PurchaseType, string> = {
  [PURCHASE_TYPES.DOMAIN_REGISTRATION]:
    'Register a custom domain for your website',
  [PURCHASE_TYPES.POLL]: 'Expand your SMS poll',
  [PURCHASE_TYPES.TEXT]: '',
  [PURCHASE_TYPES.SERVE_TEXT]: '',
}

export const PURCHASE_STATE = {
  PAYMENT: 'payment',
  SUCCESS: 'success',
  ERROR: 'error',
} as const

export type PurchaseState = (typeof PURCHASE_STATE)[keyof typeof PURCHASE_STATE]
