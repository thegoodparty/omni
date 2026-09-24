'use client'

import { useCallback, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { ArrowLeftIcon } from '@styleguide/components/ui/icons'
import { Button, Spinner, Stepper } from '@styleguide'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { useOutreachProGatingV2Flag } from 'app/shared/experiments/outreachProGatingV2Flag'
import { CAMPAIGN_VERIFICATION_PATH } from 'app/dashboard/campaign-verification/campaignVerificationPath'
import {
  PRO_UPGRADE_BASE_PATH,
  PRO_UPGRADE_STEP,
  proUpgradeStepOrder,
  proUpgradeStepPath,
  type ProUpgradeStep,
} from '../proUpgradeStep'
import {
  ProUpgradeWizardContext,
  useProUpgradeWizard,
  type ProUpgradeWizardContextValue,
} from './proUpgradeWizardContext'

export { useProUpgradeWizard }

// The desktop vertical stepper covers the four collection steps (Figma
// 7490:18728), but the payment step hides it (Figma 7563:3405) — "Payment"
// still appears as the upcoming step on the three earlier steps. value-prop,
// status, the off-order routes (guidance, filing-instructions), and the
// post-payment SUCCESS surface render the card alone.
const STEPPER_STEPS: { step: ProUpgradeStep; label: string }[] = [
  { step: PRO_UPGRADE_STEP.EIN, label: 'Campaign EIN' },
  { step: PRO_UPGRADE_STEP.FILING_DETAILS, label: 'Campaign details' },
  { step: PRO_UPGRADE_STEP.CANDIDATE_PROFILE, label: 'Candidate profile' },
  { step: PRO_UPGRADE_STEP.PAYMENT, label: 'Payment' },
]

// Purchase-only (outreach-pro-gating-v2): campaign details and the candidate
// profile move behind payment, so only two steps remain to announce.
const STEPPER_STEPS_PURCHASE_ONLY: { step: ProUpgradeStep; label: string }[] = [
  { step: PRO_UPGRADE_STEP.EIN, label: 'Campaign EIN' },
  { step: PRO_UPGRADE_STEP.PAYMENT, label: 'Payment' },
]

const STEPPER_LABELS = STEPPER_STEPS.map(({ label }) => label)

const STEPPER_LABELS_PURCHASE_ONLY = STEPPER_STEPS_PURCHASE_ONLY.map(
  ({ label }) => label,
)

const stepFromPathname = (
  pathname: string | null,
  stepOrder: ProUpgradeStep[],
): ProUpgradeStep | null => {
  if (!pathname?.startsWith(PRO_UPGRADE_BASE_PATH)) return null
  const segment = pathname.slice(PRO_UPGRADE_BASE_PATH.length + 1).split('/')[0]
  const match = stepOrder.find((step) => step === segment)
  // `filing-instructions` is a valid path but not in the linear order; surface
  // it as a step so the chrome can render Back without offering linear nav.
  if (match) return match
  // `interstitial` has no route of its own — it's only ever entered via
  // ProUpgradeFlow's `initialStep` — so a stray `/pro-upgrade/interstitial`
  // URL must not resolve to a step this route-based shell renders.
  if (segment === PRO_UPGRADE_STEP.INTERSTITIAL) return null
  return segment ? (segment as ProUpgradeStep) : null
}

// Page chrome per the Figma EIN frame (7490:18728): an Exit ghost link in a
// top nav, then the 640px card centered next to the desktop-only vertical
// stepper. stepperStep is 1-based; 0 means the current step isn't on the
// stepper, so only the card renders. cardless steps (payment, Figma
// 7563:3405) own their card + side-column layout, so the chrome renders the
// children bare at full width.
interface WizardChromeProps {
  stepperStep: number
  labels: string[]
  cardless?: boolean
  children: React.ReactNode
}

const WizardChrome = ({
  stepperStep,
  labels,
  cardless = false,
  children,
}: WizardChromeProps): React.JSX.Element => {
  const pathname = usePathname()

  return (
    <div className="min-h-screen bg-white px-6">
      <nav className="py-3">
        <Button
          asChild
          variant="ghost"
          size="small"
          className="text-base-muted-foreground"
          onClick={() => trackEvent(EVENTS.ProUpgrade.ClickExit, { pathname })}
        >
          <Link href="/dashboard">
            <ArrowLeftIcon /> Exit
          </Link>
        </Button>
      </nav>
      <main className="mx-auto flex max-w-5xl justify-center gap-16 pt-6 pb-20">
        {stepperStep > 0 && (
          <Stepper
            variant="vertical"
            currentStep={stepperStep}
            labels={labels}
            className="w-72 shrink-0 max-lg:hidden"
          />
        )}
        {cardless ? (
          <div className="w-full">{children}</div>
        ) : (
          <div className="w-full max-w-screen-sm rounded-2xl border border-base-border bg-white p-6 md:px-12 md:py-8">
            {children}
          </div>
        )}
      </main>
    </div>
  )
}

// Purchase-only (outreach-pro-gating-v2), design: renderSgModal — the same
// chrome the outreach sheet draws around the embedded flow: the "Upgrade to
// Pro" overline with Exit, the bar stepper over the five ordered steps, and a
// 608px column the step stretches into so its footer pins to the bottom. The
// filing-instructions dead end reads as the status step it branches from,
// and the success screen draws no header at all.
const PURCHASE_ONLY_ORDER = proUpgradeStepOrder(true)

const purchaseOnlyPosition = (
  step: ProUpgradeStep | null,
): { currentStep: number; totalSteps: number } | null => {
  if (step === null || step === PRO_UPGRADE_STEP.SUCCESS) return null
  const anchor =
    step === PRO_UPGRADE_STEP.FILING_INSTRUCTIONS
      ? PRO_UPGRADE_STEP.STATUS
      : step
  const index = PURCHASE_ONLY_ORDER.indexOf(anchor)
  if (index < 0) return null
  return { currentStep: index + 1, totalSteps: PURCHASE_ONLY_ORDER.length }
}

const PurchaseOnlyChrome = ({
  position,
  onExit,
  children,
}: {
  position: { currentStep: number; totalSteps: number } | null
  onExit: () => void
  children: React.ReactNode
}): React.JSX.Element => (
  <div className="flex h-dvh flex-col bg-white">
    {position && (
      <div className="shrink-0 px-6 pt-6 pb-4">
        <div className="mx-auto w-full max-w-[608px]">
          <Stepper
            variant="bar"
            overline="Upgrade to Pro"
            currentStep={position.currentStep}
            totalSteps={position.totalSteps}
            onExit={onExit}
          />
        </div>
      </div>
    )}
    <div className="flex flex-1 flex-col overflow-y-auto px-6 py-5">
      <div className="mx-auto flex w-full max-w-[608px] flex-1 flex-col">
        {children}
      </div>
    </div>
  </div>
)

interface ProUpgradeWizardProps {
  children: React.ReactNode
}

const ProUpgradeWizard = ({
  children,
}: ProUpgradeWizardProps): React.JSX.Element => {
  const router = useRouter()
  const pathname = usePathname()
  const { ready: flagReady, enabled } = useOutreachProGatingV2Flag(false)
  // An unresolved flag reads off, so committing to the default order before it
  // resolves would run a step's Continue against the wrong next step. Hold the
  // step children (not the chrome) until the flag has an answer, the same way
  // ProUpgradeEntry folds flagReady into its own `ready`.
  const purchaseOnly = flagReady && enabled

  const stepOrder = proUpgradeStepOrder(purchaseOnly)
  const currentStep = stepFromPathname(pathname, stepOrder)
  const orderIndex = currentStep ? stepOrder.indexOf(currentStep) : -1

  // Reset scroll to the top whenever the active step changes (dashboard convention).
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [currentStep])

  const goToStep = useCallback(
    (step: ProUpgradeStep) => router.push(proUpgradeStepPath(step)),
    [router],
  )

  const goToNextStep = useCallback(() => {
    if (orderIndex < 0 || orderIndex >= stepOrder.length - 1) return
    router.push(proUpgradeStepPath(stepOrder[orderIndex + 1]!))
  }, [orderIndex, stepOrder, router])

  const goToPreviousStep = useCallback(() => {
    // The off-order routes (filing-instructions, and guidance while the
    // default order is in play) are only ever entered from the filing-status
    // step, so Back targets it explicitly: router.back() would leave the
    // wizard entirely for a candidate who arrived via a direct URL (bookmark,
    // emailed link). In purchase-only mode guidance is the first ordered step,
    // so it falls through to router.back() instead.
    if (
      currentStep === PRO_UPGRADE_STEP.FILING_INSTRUCTIONS ||
      (currentStep === PRO_UPGRADE_STEP.GUIDANCE && !purchaseOnly)
    ) {
      router.push(proUpgradeStepPath(PRO_UPGRADE_STEP.STATUS))
    } else if (orderIndex > 0) {
      router.push(proUpgradeStepPath(stepOrder[orderIndex - 1]!))
    } else {
      router.back()
    }
  }, [currentStep, orderIndex, purchaseOnly, stepOrder, router])

  const exit = useCallback(() => router.push('/dashboard'), [router])
  const handleChromeExit = useCallback(() => {
    trackEvent(EVENTS.ProUpgrade.ClickExit, { pathname })
    router.push('/dashboard')
  }, [pathname, router])

  // Purchase-only collects filing details after payment, so the success step
  // hands off to campaign verification instead of the dashboard.
  const complete = useCallback(
    () => router.push(purchaseOnly ? CAMPAIGN_VERIFICATION_PATH : '/dashboard'),
    [purchaseOnly, router],
  )

  const contextValue = useMemo<ProUpgradeWizardContextValue>(
    () => ({
      currentStep,
      purchaseOnly,
      channel: null,
      goToStep,
      goToNextStep,
      goToPreviousStep,
      exit,
      complete,
    }),
    [
      currentStep,
      purchaseOnly,
      goToStep,
      goToNextStep,
      goToPreviousStep,
      exit,
      complete,
    ],
  )

  const stepperSteps = purchaseOnly
    ? STEPPER_STEPS_PURCHASE_ONLY
    : STEPPER_STEPS
  const stepperLabels = purchaseOnly
    ? STEPPER_LABELS_PURCHASE_ONLY
    : STEPPER_LABELS
  const isPayment = currentStep === PRO_UPGRADE_STEP.PAYMENT
  const stepperStep = isPayment
    ? 0
    : stepperSteps.findIndex(({ step }) => step === currentStep) + 1

  return (
    <ProUpgradeWizardContext.Provider value={contextValue}>
      {purchaseOnly ? (
        <PurchaseOnlyChrome
          position={purchaseOnlyPosition(currentStep)}
          onExit={handleChromeExit}
        >
          {children}
        </PurchaseOnlyChrome>
      ) : (
        <WizardChrome
          stepperStep={stepperStep}
          labels={stepperLabels}
          cardless={isPayment}
        >
          {flagReady ? (
            children
          ) : (
            <div className="flex h-[60vh] items-center justify-center">
              <Spinner />
            </div>
          )}
        </WizardChrome>
      )}
    </ProUpgradeWizardContext.Provider>
  )
}

export default ProUpgradeWizard
