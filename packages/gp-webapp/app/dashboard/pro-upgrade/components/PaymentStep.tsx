'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useCheckout } from '@stripe/react-stripe-js/checkout'
import { Button, ProBadge, Spinner } from '@styleguide'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { APP_BASE } from 'appEnv'
import { CheckoutSessionProvider } from 'app/dashboard/purchase/components/CheckoutSessionProvider'
import { useCheckoutSession } from 'app/dashboard/purchase/components/CheckoutSessionProvider'
import CheckoutPayment from 'app/dashboard/purchase/components/CheckoutPayment'
import PurchaseError from 'app/dashboard/purchase/components/PurchaseError'
import { createProSubscriptionCheckoutSession } from 'app/dashboard/purchase/utils/purchaseFetch.utils'
import { PRO_UPGRADE_STEP, proUpgradeStepPath } from '../proUpgradeStep'
import { useProUpgradeWizard } from './ProUpgradeWizard'

// Stripe sends the candidate here when a confirm requires a redirect (e.g.
// 3DS). The success step (task 14) reads the post-payment state; isPro is
// flipped by the webhook, never client-side.
const SUCCESS_RETURN_URL = `${APP_BASE}${proUpgradeStepPath(
  PRO_UPGRADE_STEP.SUCCESS,
)}`

// Reads the live total from the mounted Stripe checkout so the amount can't
// drift from the configured Stripe price. Rendered inside CheckoutProvider.
// Design: the "Pro subscription" card above the payment details.
const OrderSummary = (): React.JSX.Element => {
  const checkoutResult = useCheckout()
  const monthly =
    checkoutResult.type === 'loading' || checkoutResult.type === 'error'
      ? null
      : checkoutResult.checkout.total.total.minorUnitsAmount / 100
  const amountLabel = monthly === null ? null : `$${monthly.toFixed(2)}`

  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-base-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[15px] font-semibold">Pro subscription</span>
        <ProBadge />
      </div>
      <div className="h-px bg-base-border" />
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="text-base-muted-foreground">Pro plan, monthly</span>
        <span className="font-medium">
          {amountLabel === null ? '—' : `${amountLabel}/mo`}
        </span>
      </div>
      <div className="flex items-center justify-between gap-3 text-[15px] font-semibold">
        <span>Total due today</span>
        <span>{amountLabel ?? '—'}</span>
      </div>
    </div>
  )
}

// One column, as the design draws it on every width: title, the
// subscription card, the payment card, the terms line, and Back pinned to
// the bottom of the host's column.
const PaymentFrame = ({
  onBack,
  summary,
  children,
}: {
  onBack: () => void
  summary?: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element => (
  <div className="flex min-h-full flex-1 flex-col gap-4">
    <div>
      <h1 className="mb-2 text-xl font-semibold">Complete your upgrade</h1>
      <p className="text-base text-base-muted-foreground">
        Pro is $10/mo, cancel anytime.
      </p>
    </div>
    {summary}
    <div className="rounded-xl border border-base-border bg-card p-4">
      <p className="mb-3 font-semibold">Payment details</p>
      {children}
    </div>
    <p className="text-xs text-base-muted-foreground">
      By subscribing, you authorize us to charge you according to the terms
      until you cancel.
    </p>
    <div className="mt-auto pt-8">
      <Button variant="ghost" size="large" onClick={onBack}>
        Back
      </Button>
    </div>
  </div>
)

const PaymentContent = ({
  onConfirmed,
  onBack,
}: {
  onConfirmed: () => void
  onBack: () => void
}): React.JSX.Element => {
  const { checkoutSession, error, fetchClientSecret } = useCheckoutSession()
  const hasFetchedSession = useRef(false)

  useEffect(() => {
    if (!hasFetchedSession.current) {
      hasFetchedSession.current = true
      fetchClientSecret().catch(() => {
        // Surfaced via the provider's `error` state below.
      })
    }
  }, [fetchClientSecret])

  // Only a failed session fetch (no checkout to show) is a dead-end. Once the
  // checkout has mounted, a failed/declined payment also sets `error`, but we
  // keep the form so the candidate can fix their card and retry rather than
  // being bounced to an error screen.
  if (error && !checkoutSession) {
    return (
      <PaymentFrame onBack={onBack}>
        <PurchaseError error={error} serverError={undefined} />
      </PaymentFrame>
    )
  }

  if (!checkoutSession) {
    return (
      <PaymentFrame onBack={onBack}>
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      </PaymentFrame>
    )
  }

  return (
    <CheckoutPayment
      onPaymentConfirmed={onConfirmed}
      submitLabel="Complete upgrade"
      renderLayout={(form) => (
        <PaymentFrame onBack={onBack} summary={<OrderSummary />}>
          {form}
        </PaymentFrame>
      )}
    />
  )
}

const PaymentStep = (): React.JSX.Element => {
  const { goToStep, goToPreviousStep } = useProUpgradeWizard()

  useEffect(() => {
    trackEvent(EVENTS.ProUpgrade.Compliance.PaymentViewed)
  }, [])

  const createSession = useCallback(
    () => createProSubscriptionCheckoutSession(SUCCESS_RETURN_URL),
    [],
  )

  const handleConfirmed = useCallback(() => {
    goToStep(PRO_UPGRADE_STEP.SUCCESS)
  }, [goToStep])

  return (
    <CheckoutSessionProvider createSession={createSession}>
      <PaymentContent onConfirmed={handleConfirmed} onBack={goToPreviousStep} />
    </CheckoutSessionProvider>
  )
}

export default PaymentStep
