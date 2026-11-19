'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useCheckout } from '@stripe/react-stripe-js/checkout'
import { PLAN_PRICING } from '@goodparty_org/contracts'
import { Badge, Button, ProBadge, Spinner } from '@styleguide'
import { CalendarClockIcon } from '@styleguide/components/ui/icons'
import { StepFooter } from 'app/dashboard/shared/StepFooter'
import { useSmsCompliance } from 'app/dashboard/shared/smsCutoff/useSmsCompliance'
import {
  SMS_CUTOFF_COPY,
  formatSmsCutoffDate,
} from 'app/dashboard/campaign-verification/verificationCopy'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { APP_BASE } from 'appEnv'
import { CheckoutSessionProvider } from 'app/dashboard/purchase/components/CheckoutSessionProvider'
import { useCheckoutSession } from 'app/dashboard/purchase/components/CheckoutSessionProvider'
import CheckoutPayment from 'app/dashboard/purchase/components/CheckoutPayment'
import PurchaseError from 'app/dashboard/purchase/components/PurchaseError'
import {
  completeCheckoutSession,
  createPlanCheckoutSession,
  createProSubscriptionCheckoutSession,
} from 'app/dashboard/purchase/utils/purchaseFetch.utils'
import { useCampaign } from '@shared/hooks/useCampaign'
import { formatPlanCents } from 'app/dashboard/shared/plan/planPitch'
import { useWinPerCampaignPricingFlag } from 'app/shared/experiments/winPerCampaignPricingFlag'
import { carryQueryString, type ProUpgradePlan } from '../proUpgradePlanParams'
import { useProUpgradeCarry } from './proUpgradeCarryContext'
import { PRO_UPGRADE_STEP, proUpgradeStepPath } from '../proUpgradeStep'
import { usePlan } from 'app/dashboard/shared/membership/deriveMembershipState'
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

const dollars = (cents: number): string => `$${(cents / 100).toFixed(2)}`

const TEAM_UPGRADE_CENTS = PLAN_PRICING.teamCents - PLAN_PRICING.proCents

interface PlanCheckout {
  plan: ProUpgradePlan
  name: string
  priceCents: number
  // A Pro holder buying Team pays the difference only.
  isUpgrade: boolean
  chargeCents: number
}

const planCheckout = (
  plan: ProUpgradePlan,
  isUpgrade: boolean,
): PlanCheckout => {
  const priceCents =
    plan === 'team' ? PLAN_PRICING.teamCents : PLAN_PRICING.proCents
  return {
    plan,
    name: plan === 'team' ? 'Team' : 'Pro',
    priceCents,
    isUpgrade,
    chargeCents: isUpgrade ? TEAM_UPGRADE_CENTS : priceCents,
  }
}

// Design: the one-time plan card. The total reads the live Stripe total so a
// promo code shows in it; the lines above are the plan's own price.
const PlanOrderSummary = ({
  checkout: order,
}: {
  checkout: PlanCheckout
}): React.JSX.Element => {
  const checkoutResult = useCheckout()
  const total =
    checkoutResult.type === 'loading' || checkoutResult.type === 'error'
      ? null
      : checkoutResult.checkout.total.total.minorUnitsAmount
  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-base-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[15px] font-semibold">{order.name}</span>
        {order.plan === 'team' ? (
          <Badge className="font-bold italic">TEAM</Badge>
        ) : (
          <ProBadge />
        )}
      </div>
      <div className="h-px bg-base-border" />
      {order.isUpgrade ? (
        <>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span>Team plan</span>
            <span className="font-medium">
              {dollars(PLAN_PRICING.teamCents)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span>Pro, already paid</span>
            <span className="font-medium">
              &minus;{dollars(PLAN_PRICING.proCents)}
            </span>
          </div>
        </>
      ) : (
        <div className="flex items-center justify-between gap-3 text-sm">
          <span>{`${order.name} plan with ${formatPlanCents(PLAN_PRICING.includedCreditCents)} outreach credit`}</span>
          <span className="font-medium">{dollars(order.priceCents)}</span>
        </div>
      )}
      <div className="h-px bg-base-border" />
      <div className="flex items-center justify-between gap-3 text-[15px] font-semibold">
        <span>Total</span>
        <span>{total === null ? '—' : dollars(total)}</span>
      </div>
    </div>
  )
}

// Verification starts at payment, so a texting or standalone launch says so
// under the price. In the closing week it names the cutoff instead, and once
// texting has closed there is nothing to verify, so it says nothing.
const SmsVerificationLine = ({
  openCopy = SMS_CUTOFF_COPY.paymentVerificationStarts,
}: {
  openCopy?: string
}): React.JSX.Element | null => {
  const { channel } = useProUpgradeWizard()
  const { smsCompliance, smsCutoffDate } = useSmsCompliance()
  if (channel !== 'sms' && channel !== null) return null
  if (smsCompliance === 'open') {
    return <p className="mt-2 text-sm text-base-muted-foreground">{openCopy}</p>
  }
  if (smsCompliance === 'closing' && smsCutoffDate) {
    return (
      <p className="mt-2 flex items-center gap-2 text-sm font-medium text-warning-dark">
        <CalendarClockIcon className="size-4 shrink-0" aria-hidden />
        {SMS_CUTOFF_COPY.paymentClosing(formatSmsCutoffDate(smsCutoffDate))}
      </p>
    )
  }
  return null
}

// One column, as the design draws it on every width: title, the
// subscription card, the payment card, the terms line, and Back pinned to
// the bottom of the host's column.
const PaymentFrame = ({
  onBack,
  summary,
  intro,
  footnote,
  children,
}: {
  onBack: () => void
  summary?: React.ReactNode
  intro: React.ReactNode
  footnote: string
  children: React.ReactNode
}): React.JSX.Element => (
  <div className="flex min-h-full flex-1 flex-col gap-4">
    <div>
      <h1 className="mb-2 text-xl font-semibold">Complete your upgrade</h1>
      {intro}
    </div>
    {summary}
    <div className="rounded-xl border border-base-border bg-card p-4">
      <p className="mb-3 font-semibold">Payment details</p>
      {children}
    </div>
    <p className="text-xs text-base-muted-foreground">{footnote}</p>
    <StepFooter align="start">
      <Button variant="ghost" size="large" onClick={onBack}>
        Back
      </Button>
    </StepFooter>
  </div>
)

const SUBSCRIPTION_INTRO = (
  <>
    <p className="text-base text-base-muted-foreground">
      Pro is $10/mo, cancel anytime.
    </p>
    <SmsVerificationLine />
  </>
)

const SUBSCRIPTION_FOOTNOTE =
  'By subscribing, you authorize us to charge you according to the terms until you cancel.'

const planIntro = (order: PlanCheckout): React.ReactNode => (
  <>
    <p className="text-base text-base-muted-foreground">
      {order.isUpgrade
        ? 'You only pay the difference from Pro.'
        : `${order.name} is ${formatPlanCents(order.priceCents)} per campaign.`}
    </p>
    {!order.isUpgrade && (
      <SmsVerificationLine openCopy="Texting registration takes 1 to 2 weeks. Everything else unlocks now." />
    )}
  </>
)

const PLAN_FOOTNOTE = 'Secure payment through Stripe. One payment.'

interface PaymentContentProps {
  onConfirmed?: () => void
  onPaymentSuccess?: (sessionId: string) => Promise<void>
  onBack: () => void
  submitLabel: string | ((totalDollars: number | null) => string)
  intro: React.ReactNode
  footnote: string
  summary: React.ReactNode
}

const PaymentContent = ({
  onConfirmed,
  onPaymentSuccess,
  onBack,
  submitLabel,
  intro,
  footnote,
  summary,
}: PaymentContentProps): React.JSX.Element => {
  const { checkoutSession, error, fetchClientSecret } = useCheckoutSession()
  const hasFetchedSession = useRef(false)
  const [total, setTotal] = useState<number | null>(null)

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
      <PaymentFrame onBack={onBack} intro={intro} footnote={footnote}>
        <PurchaseError error={error} serverError={undefined} />
      </PaymentFrame>
    )
  }

  if (!checkoutSession) {
    return (
      <PaymentFrame onBack={onBack} intro={intro} footnote={footnote}>
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      </PaymentFrame>
    )
  }

  return (
    <CheckoutPayment
      onPaymentConfirmed={onConfirmed}
      onPaymentSuccess={onPaymentSuccess}
      onTotalChange={setTotal}
      submitLabel={
        typeof submitLabel === 'string' ? submitLabel : submitLabel(total)
      }
      renderLayout={(form) => (
        <PaymentFrame
          onBack={onBack}
          summary={summary}
          intro={intro}
          footnote={footnote}
        >
          {form}
        </PaymentFrame>
      )}
    />
  )
}

const SubscriptionPayment = (): React.JSX.Element => {
  const { goToStep, goToPreviousStep } = useProUpgradeWizard()

  const createSession = useCallback(
    () => createProSubscriptionCheckoutSession(SUCCESS_RETURN_URL),
    [],
  )

  const handleConfirmed = useCallback(() => {
    goToStep(PRO_UPGRADE_STEP.SUCCESS)
  }, [goToStep])

  return (
    <CheckoutSessionProvider createSession={createSession}>
      <PaymentContent
        onConfirmed={handleConfirmed}
        onBack={goToPreviousStep}
        submitLabel="Complete upgrade"
        intro={SUBSCRIPTION_INTRO}
        footnote={SUBSCRIPTION_FOOTNOTE}
        summary={<OrderSummary />}
      />
    </CheckoutSessionProvider>
  )
}

const PlanPayment = (): React.JSX.Element => {
  const { goToStep, goToPreviousStep } = useProUpgradeWizard()
  const carry = useProUpgradeCarry()
  const { plan: heldPlan } = usePlan()
  const [campaign] = useCampaign()
  const campaignId = campaign?.id

  const isUpgrade = carry.plan === 'team' && heldPlan === 'pro'
  const order = planCheckout(
    carry.plan ?? (heldPlan === 'pro' ? 'team' : 'pro'),
    isUpgrade,
  )

  // Stripe returns here after a redirecting method (Afterpay, 3DS), and the
  // URL has to say what was bought, since the page loads fresh.
  const returnUrl = `${SUCCESS_RETURN_URL}${carryQueryString({
    ...carry,
    plan: order.plan,
    fromPro: isUpgrade,
  })}`

  const createSession = useCallback(() => {
    if (!campaignId) {
      return Promise.reject(new Error('Your campaign could not be loaded.'))
    }
    return createPlanCheckoutSession(campaignId, order.plan, returnUrl)
  }, [campaignId, order.plan, returnUrl])

  const handlePaymentSuccess = useCallback(
    async (sessionId: string) => {
      const response = await completeCheckoutSession(sessionId)
      if (!response.ok) {
        throw new Error(
          'Your payment went through, but we could not finish the upgrade. Refresh in a moment, or contact support if it does not update.',
        )
      }
      if (isUpgrade) carry.markFromPro()
      goToStep(PRO_UPGRADE_STEP.SUCCESS)
    },
    [goToStep, isUpgrade, carry],
  )

  const submitLabel = useCallback(
    (total: number | null) =>
      `Pay ${formatPlanCents(
        total === null ? order.chargeCents : Math.round(total * 100),
      )}`,
    [order.chargeCents],
  )

  return (
    <CheckoutSessionProvider createSession={createSession}>
      <PaymentContent
        onPaymentSuccess={handlePaymentSuccess}
        onBack={goToPreviousStep}
        submitLabel={submitLabel}
        intro={planIntro(order)}
        footnote={PLAN_FOOTNOTE}
        summary={<PlanOrderSummary checkout={order} />}
      />
    </CheckoutSessionProvider>
  )
}

// With the per-campaign flag on, the plan is a one-time PLAN purchase; with
// it off, the Pro subscription stays exactly as it was. The flag is awaited
// so a candidate is never shown one checkout and charged through the other.
const PaymentStep = (): React.JSX.Element => {
  const { plan } = usePlan()
  const { ready, enabled } = useWinPerCampaignPricingFlag()

  useEffect(() => {
    trackEvent(EVENTS.ProUpgrade.Compliance.PaymentViewed, { plan })
  }, [plan])

  if (!ready) {
    return (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    )
  }

  return enabled ? <PlanPayment /> : <SubscriptionPayment />
}

export default PaymentStep
