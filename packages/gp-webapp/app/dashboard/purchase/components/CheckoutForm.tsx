'use client'

import { FormEvent, useEffect, useRef, useState } from 'react'
import {
  ExpressCheckoutElement,
  PaymentElement,
  useCheckout,
  StripeCheckoutValue,
} from '@stripe/react-stripe-js/checkout'
import { Button } from '@styleguide'
import { Alert, AlertDescription } from '@styleguide/components/ui/alert'
import { useSnackbar } from '@shared/utils/Snackbar'
import { reportClientError } from '@shared/observability/reportClientError'
import { useMutation } from '@tanstack/react-query'
import {
  StripeCheckoutExpressCheckoutElementOptions,
  StripeCheckoutPaymentElementOptions,
  StripeError,
  StripeExpressCheckoutElementConfirmEvent,
  StripeExpressCheckoutElementReadyEvent,
} from '@stripe/stripe-js'
import { useCheckoutSession } from './CheckoutSessionProvider'
import { Spinner } from '@styleguide'
import PromoCodeSection, { usePromoCode } from './PromoCodeSection'

interface CheckoutFormProps {
  // Fired after a successful confirm when there is a Stripe session id to act
  // on (one-time purchases call completeCheckoutSession with it).
  onSuccess?: (sessionId: string) => void
  // Fired after a successful confirm when there is no session id (the Pro
  // subscription flow, where gp-api returns only a clientSecret and fulfillment
  // happens via the Stripe webhook).
  onConfirmed?: () => void | Promise<void>
  onError?: (error: string) => void
  // Stripe's live total in dollars, reported on mount and whenever it changes
  // (a promo code applying or being removed).
  onTotalChange?: (totalDollars: number) => void
  sessionId?: string
  submitLabel?: string
  // Per-campaign pricing layout: Apple Pay / Google Pay buttons on top, then
  // "Or pay another way" and the methods as a stacked accordion. Off keeps the
  // tabbed Payment Element exactly as it was.
  walletsAndAccordion?: boolean
  // The host draws the promo code control (a link under its order total), so
  // the grey Promo Code box above the form is not rendered.
  hidePromoSection?: boolean
}

// Only the two wallets the design draws; no Link, PayPal, Amazon Pay or
// Klarna button.
const EXPRESS_CHECKOUT_OPTIONS: StripeCheckoutExpressCheckoutElementOptions = {
  buttonHeight: 48,
  buttonTheme: { applePay: 'black', googlePay: 'black' },
  buttonType: { applePay: 'plain', googlePay: 'plain' },
  layout: { maxColumns: 2, maxRows: 1, overflow: 'never' },
  paymentMethodOrder: ['apple_pay', 'google_pay'],
  paymentMethods: {
    applePay: 'auto',
    googlePay: 'auto',
    link: 'never',
    amazonPay: 'never',
    paypal: 'never',
    klarna: 'never',
  },
}

// Wallets ride on the Express Checkout buttons above, so the Payment Element
// must not offer them a second time.
const ACCORDION_PAYMENT_ELEMENT_OPTIONS: StripeCheckoutPaymentElementOptions = {
  layout: {
    type: 'accordion',
    radios: true,
    spacedAccordionItems: true,
    defaultCollapsed: false,
  },
  wallets: { applePay: 'never', googlePay: 'never', link: 'never' },
}

export default function CheckoutForm({
  onSuccess,
  onConfirmed,
  onError,
  onTotalChange,
  sessionId,
  submitLabel,
  walletsAndAccordion,
  hidePromoSection,
}: CheckoutFormProps): React.JSX.Element {
  const { setError } = useCheckoutSession()
  const checkoutResult = useCheckout()
  const { errorSnackbar } = useSnackbar()
  const errorHandledRef = useRef(false)

  useEffect(() => {
    if (checkoutResult.type === 'error' && !errorHandledRef.current) {
      errorHandledRef.current = true
      const msg = checkoutResult.error.message || 'Unexpected payment error'
      reportClientError(new Error('checkout form initialization error'), {
        stripeError: checkoutResult.error,
      })
      errorSnackbar(msg)
      setError(msg)
      if (onError) {
        onError(msg)
      }
    }
  }, [checkoutResult, errorSnackbar, setError, onError])

  if (checkoutResult.type === 'loading') {
    return (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    )
  }

  if (checkoutResult.type === 'error') {
    return (
      <div className="text-red-600 text-center py-4">
        {checkoutResult.error.message}
      </div>
    )
  }

  const { checkout } = checkoutResult

  return (
    <CheckoutFormContent
      checkout={checkout}
      sessionId={sessionId}
      onSuccess={onSuccess}
      onConfirmed={onConfirmed}
      onTotalChange={onTotalChange}
      submitLabel={submitLabel}
      walletsAndAccordion={walletsAndAccordion}
      hidePromoSection={hidePromoSection}
      onError={(error) => {
        let msg: string
        if (error instanceof Error) {
          msg = error.message
          reportClientError(error, { location: 'checkout-form' })
        } else {
          msg = error.message || 'Unexpected payment error'
          reportClientError(new Error('checkout form stripe error'), {
            stripeError: error,
          })
        }
        errorSnackbar(msg)
        setError(msg)
        if (onError) {
          onError(msg)
        }
      }}
    />
  )
}

// Separate component to avoid hooks conditionally
function CheckoutFormContent({
  checkout,
  sessionId,
  onSuccess,
  onConfirmed,
  submitLabel = 'Complete Purchase',
  onError,
  onTotalChange,
  walletsAndAccordion = false,
  hidePromoSection = false,
}: {
  checkout: StripeCheckoutValue
  sessionId?: string
  onSuccess?: (sessionId: string) => void
  onConfirmed?: () => void | Promise<void>
  submitLabel?: string
  onError: (error: Error | StripeError) => void
  onTotalChange?: (totalDollars: number) => void
  walletsAndAccordion?: boolean
  hidePromoSection?: boolean
}): React.JSX.Element {
  const promo = usePromoCode(checkout)
  const [hasConfirmedPayment, setHasConfirmedPayment] = useState(false)
  // Pay is never disabled on checkout.canConfirm: it lags the last keystroke
  // until the field blurs, so a click right after typing hit a disabled button
  // and did nothing. confirm() validates, and its error shows below.
  // The toast is gone in 4s and sits over Back, so a declined or failed
  // confirm also stays on the form until the next attempt.
  const [submitError, setSubmitError] = useState<string | null>(null)
  // The divider only makes sense when a wallet button actually rendered on
  // this device; Stripe reports that on ready.
  const [hasWallet, setHasWallet] = useState(false)

  const mutation = useMutation({
    mutationFn: async (
      expressEvent?: StripeExpressCheckoutElementConfirmEvent,
    ) => {
      // One-time purchases complete via `onSuccess(sessionId)`. Without a
      // session id and without an `onConfirmed` fallback we'd charge the card
      // and then silently skip fulfillment, so fail before confirming. (The
      // subscription path passes `onConfirmed` and no session id.)
      if (!sessionId && !onConfirmed) {
        throw new Error('Missing checkout session ID')
      }

      if (!hasConfirmedPayment) {
        const result = await checkout.confirm({
          redirect: 'if_required',
          ...(expressEvent && { expressCheckoutConfirmEvent: expressEvent }),
        })

        if (result.type === 'error') {
          // Closes the wallet sheet with a failure instead of leaving it
          // spinning.
          expressEvent?.paymentFailed({ reason: 'fail' })
          throw result.error
        }

        setHasConfirmedPayment(true)
      }

      // One-time purchases complete via the session id; the Pro subscription
      // has no session id client-side and finalizes through the webhook, so it
      // just signals confirmation.
      if (sessionId) {
        await onSuccess?.(sessionId)
      } else {
        await onConfirmed?.()
      }
    },
    onError: (error) => {
      setSubmitError(error.message || 'Unexpected payment error')
      onError(error)
    },
  })

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitError(null)
    mutation.mutate(undefined)
  }

  // The wallet sheet confirms the same session as Pay, then takes the same
  // success path (completeCheckoutSession / onConfirmed).
  const handleExpressConfirm = (
    event: StripeExpressCheckoutElementConfirmEvent,
  ) => {
    setSubmitError(null)
    mutation.mutate(event)
  }

  const handleExpressReady = ({
    availablePaymentMethods,
  }: StripeExpressCheckoutElementReadyEvent) => {
    setHasWallet(
      Boolean(
        availablePaymentMethods?.applePay || availablePaymentMethods?.googlePay,
      ),
    )
  }

  const currentTotal = checkout.total.total.minorUnitsAmount / 100
  const originalTotal = checkout.total.subtotal.minorUnitsAmount / 100

  useEffect(() => {
    onTotalChange?.(currentTotal)
  }, [currentTotal, onTotalChange])

  return (
    <form onSubmit={handleSubmit}>
      {walletsAndAccordion && (
        <div className="mb-4">
          <ExpressCheckoutElement
            options={EXPRESS_CHECKOUT_OPTIONS}
            onReady={handleExpressReady}
            onConfirm={handleExpressConfirm}
          />
          {hasWallet && (
            <div
              aria-hidden="true"
              className="mt-4 flex items-center gap-3 text-sm text-base-muted-foreground"
            >
              <span className="flex-1 border-t border-base-border" />
              Or pay another way
              <span className="flex-1 border-t border-base-border" />
            </div>
          )}
        </div>
      )}

      {originalTotal > 0 && !hidePromoSection && (
        <div className="mb-6">
          <PromoCodeSection {...promo} />

          {promo.hasAppliedPromo && (
            <div className="mt-3 pt-3 border-t flex justify-between items-center px-4">
              <span className="font-medium text-gray-700">
                Discounted Total
              </span>
              <div className="text-right">
                <span className="text-sm text-gray-400 line-through mr-2">
                  ${originalTotal.toFixed(2)}
                </span>
                <span className="font-semibold text-lg text-green-600">
                  ${currentTotal.toFixed(2)}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      <PaymentElement
        onLoadError={({ error }) => {
          onError(error)
        }}
        options={
          walletsAndAccordion
            ? ACCORDION_PAYMENT_ELEMENT_OPTIONS
            : { layout: 'tabs' }
        }
      />
      {submitError && (
        <Alert variant="destructive" className="mt-4">
          <AlertDescription>{submitError}</AlertDescription>
        </Alert>
      )}
      <Button
        type="submit"
        disabled={mutation.isPending}
        loading={mutation.isPending}
        className="mt-6 w-full whitespace-nowrap"
        size="large"
      >
        {submitLabel}
      </Button>
    </form>
  )
}
