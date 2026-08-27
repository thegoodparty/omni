'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useCheckout } from '@stripe/react-stripe-js/checkout'
import { ProBadge } from '@styleguide'
import Body2 from '@shared/typography/Body2'
import { LoadingAnimation } from '@shared/utils/LoadingAnimation'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { APP_BASE } from 'appEnv'
import { CheckoutSessionProvider } from 'app/dashboard/purchase/components/CheckoutSessionProvider'
import { useCheckoutSession } from 'app/dashboard/purchase/components/CheckoutSessionProvider'
import CheckoutPayment from 'app/dashboard/purchase/components/CheckoutPayment'
import PurchaseError from 'app/dashboard/purchase/components/PurchaseError'
import { createProSubscriptionCheckoutSession } from 'app/dashboard/purchase/utils/purchaseFetch.utils'
import { PRO_UPGRADE_STEP, proUpgradeStepPath } from '../proUpgradeStep'
import { useProUpgradeWizard } from './ProUpgradeWizard'
import WizardStepFooter from './WizardStepFooter'
import WizardHeading from './WizardHeading'

// Stripe sends the candidate here when a confirm requires a redirect (e.g.
// 3DS). The success step (task 14) reads the post-payment state; isPro is
// flipped by the webhook, never client-side.
const SUCCESS_RETURN_URL = `${APP_BASE}${proUpgradeStepPath(
  PRO_UPGRADE_STEP.SUCCESS,
)}`

// Reads the live total from the mounted Stripe checkout so the amount can't
// drift from the configured Stripe price. Rendered inside CheckoutProvider.
// Borderless: it sits beside the form card, not in one (Figma 7563:3405).
const OrderSummary = (): React.JSX.Element => {
  const checkoutResult = useCheckout()
  const monthly =
    checkoutResult.type === 'loading' || checkoutResult.type === 'error'
      ? null
      : checkoutResult.checkout.total.total.minorUnitsAmount / 100
  const amountLabel = monthly === null ? null : `$${monthly.toFixed(2)}`

  return (
    <aside className="w-full max-w-screen-sm">
      <div className="flex items-center justify-between">
        <span className="font-medium">Pro Plan</span>
        <ProBadge />
      </div>
      <Body2 className="text-base-muted-foreground mt-1">Billed monthly</Body2>

      <div className="mt-6 flex items-baseline justify-between">
        <span className="text-base-muted-foreground">Monthly</span>
        <span className="font-medium">
          {amountLabel === null ? '—' : `${amountLabel}/mo`}
        </span>
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-base-border pt-4">
        <span className="font-semibold">Total</span>
        <span className="font-semibold">{amountLabel ?? '—'}</span>
      </div>
    </aside>
  )
}

// The wizard chrome renders the payment step cardless, so the step owns its
// layout: the bordered form card next to the borderless order summary on
// desktop, stacked and centered below lg (Figma 7563:3405).
const PaymentFrame = ({
  onBack,
  summary,
  children,
}: {
  onBack: () => void
  summary?: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element => (
  <div className="flex flex-col items-center gap-8 lg:grid lg:grid-cols-[1fr_360px] lg:items-start lg:gap-16">
    <div className="w-full max-w-screen-sm rounded-2xl border border-base-border bg-white p-6 md:px-12 md:py-8">
      <WizardHeading title="Complete your upgrade" />
      {children}
      {/* Stripe's embedded Checkout owns the forward CTA, so the takeover
          footer carries Back alone (recorded design divergence). */}
      <WizardStepFooter back={{ onClick: onBack }} />
    </div>
    {summary}
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
        <LoadingAnimation />
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
