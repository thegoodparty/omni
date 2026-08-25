import { FetchError } from 'ofetch'
import { apiRoutes } from 'gpApi/routes'
import { clientFetch, ApiResponse } from 'gpApi/clientFetch'
import { clientRequest } from 'gpApi/typed-request'

interface CompletePurchaseResponse {
  success: boolean
}

export interface CheckoutSessionResponse {
  // `id` and `amount` come back for the one-time Custom Checkout sessions but
  // not for the Pro subscription session (gp-api returns only `clientSecret`),
  // so both are optional. Consumers already default `amount` and treat `id` as
  // an optional Stripe session id.
  id?: string
  clientSecret: string
  amount?: number
}

export function createCheckoutSession(
  type: string,
  metadata: Record<string, string | number | boolean | undefined>,
  receiptEmail?: string,
  returnUrl?: string,
  allowPromoCodes = true,
): Promise<ApiResponse<CheckoutSessionResponse>> {
  return clientFetch(apiRoutes.payments.createCustomCheckoutSession, {
    type,
    metadata,
    ...(receiptEmail && { receiptEmail }),
    returnUrl,
    allowPromoCodes,
  })
}

// Pro $10/mo subscription. Mounts the same embedded Stripe Custom Checkout as
// the one-time flow, but the session is created by gp-api's
// `createProCheckoutSession` (embedded mode) which returns only a
// `clientSecret`. `returnUrl` is where Stripe sends the candidate when a
// confirm requires a redirect (e.g. 3DS). `isPro` is flipped by the Stripe
// webhook, not here.
// gp-api's checkout-session guards (ENG-10771) answer with typed errorCodes;
// surfacing them verbatim left candidates staring at a generic "[POST] ...:
// 400" after filling out the whole wizard (ENG-10892). Translate each guard
// into an actionable message for the payment step's error surface.
const PRO_CHECKOUT_ERROR_MESSAGES: Record<string, string> = {
  NO_ACTIVE_CAMPAIGN:
    'Your campaign is not currently active, so we could not start a Pro ' +
    'subscription. This usually means the election date has passed or an ' +
    'election result was recorded. Contact us at campaignsuccess@goodparty.org ' +
    'and we will get your campaign updated.',
  ALREADY_PRO: 'You already have an active Pro subscription.',
  CHECKOUT_ALREADY_COMPLETED:
    'Your payment already went through. Your account should update in a ' +
    'moment — try refreshing the page.',
  CHECKOUT_IN_PROGRESS:
    'Another checkout is already in progress. Please wait a moment and try again.',
}

export async function createProSubscriptionCheckoutSession(
  returnUrl?: string,
): Promise<CheckoutSessionResponse> {
  let data
  try {
    ;({ data } = await clientRequest(
      'POST /v1/payments/purchase/checkout-session',
      { embedded: true, returnUrl },
    ))
  } catch (err) {
    const errorCode =
      err instanceof FetchError
        ? (err.data as { errorCode?: string } | undefined)?.errorCode
        : undefined
    const message = errorCode && PRO_CHECKOUT_ERROR_MESSAGES[errorCode]
    if (message) {
      throw new Error(message)
    }
    throw err
  }

  if (!data.clientSecret) {
    throw new Error('Missing client secret for Pro subscription checkout')
  }

  return { clientSecret: data.clientSecret }
}

export function completeCheckoutSession(
  checkoutSessionId: string,
): Promise<ApiResponse<CompletePurchaseResponse>> {
  return clientFetch(apiRoutes.payments.completeCheckoutSession, {
    checkoutSessionId,
  })
}

export function completeFreePurchase(
  purchaseType: string,
  metadata: Record<string, string | number | boolean | undefined>,
): Promise<ApiResponse<CompletePurchaseResponse>> {
  return clientFetch(apiRoutes.payments.completeFreePurchase, {
    purchaseType,
    metadata,
  })
}
