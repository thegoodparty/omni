'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
} from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { ArrowLeftIcon } from '@styleguide/components/ui/icons'
import { Button, Stepper } from '@styleguide'
import { noop } from '@shared/utils/noop'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import {
  PRO_UPGRADE_BASE_PATH,
  PRO_UPGRADE_STEP,
  PRO_UPGRADE_STEP_ORDER,
  proUpgradeStepPath,
  type ProUpgradeStep,
} from '../proUpgradeStep'

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

const STEPPER_LABELS = STEPPER_STEPS.map(({ label }) => label)

interface ProUpgradeWizardContextValue {
  // null on the wizard index (before redirect) or on any non-step path.
  currentStep: ProUpgradeStep | null
  goToStep: (step: ProUpgradeStep) => void
  goToNextStep: () => void
  goToPreviousStep: () => void
}

const ProUpgradeWizardContext = createContext<ProUpgradeWizardContextValue>({
  currentStep: null,
  goToStep: noop,
  goToNextStep: noop,
  goToPreviousStep: noop,
})

// Per-step pages (tasks 06–14) read this to drive their own forward CTAs and
// to know which step is active.
export const useProUpgradeWizard = (): ProUpgradeWizardContextValue =>
  useContext(ProUpgradeWizardContext)

const stepFromPathname = (pathname: string | null): ProUpgradeStep | null => {
  if (!pathname?.startsWith(PRO_UPGRADE_BASE_PATH)) return null
  const segment = pathname.slice(PRO_UPGRADE_BASE_PATH.length + 1).split('/')[0]
  const match = PRO_UPGRADE_STEP_ORDER.find((step) => step === segment)
  // `filing-instructions` is a valid path but not in the linear order; surface
  // it as a step so the chrome can render Back without offering linear nav.
  if (match) return match
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
  cardless?: boolean
  children: React.ReactNode
}

const WizardChrome = ({
  stepperStep,
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
            labels={STEPPER_LABELS}
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

interface ProUpgradeWizardProps {
  children: React.ReactNode
}

const ProUpgradeWizard = ({
  children,
}: ProUpgradeWizardProps): React.JSX.Element => {
  const router = useRouter()
  const pathname = usePathname()

  const currentStep = stepFromPathname(pathname)
  const orderIndex = currentStep
    ? PRO_UPGRADE_STEP_ORDER.indexOf(currentStep)
    : -1

  // Reset scroll to the top whenever the active step changes (dashboard convention).
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [currentStep])

  const goToStep = useCallback(
    (step: ProUpgradeStep) => router.push(proUpgradeStepPath(step)),
    [router],
  )

  const goToNextStep = useCallback(() => {
    if (orderIndex < 0 || orderIndex >= PRO_UPGRADE_STEP_ORDER.length - 1)
      return
    router.push(proUpgradeStepPath(PRO_UPGRADE_STEP_ORDER[orderIndex + 1]!))
  }, [orderIndex, router])

  const goToPreviousStep = useCallback(() => {
    // The off-order routes (guidance, filing-instructions) are only ever
    // entered from the filing-status step, so Back targets it explicitly:
    // router.back() would leave the wizard entirely for a candidate who
    // arrived via a direct URL (bookmark, emailed link).
    if (
      currentStep === PRO_UPGRADE_STEP.FILING_INSTRUCTIONS ||
      currentStep === PRO_UPGRADE_STEP.GUIDANCE
    ) {
      router.push(proUpgradeStepPath(PRO_UPGRADE_STEP.STATUS))
    } else if (orderIndex > 0) {
      router.push(proUpgradeStepPath(PRO_UPGRADE_STEP_ORDER[orderIndex - 1]!))
    } else {
      router.back()
    }
  }, [currentStep, orderIndex, router])

  const contextValue = useMemo<ProUpgradeWizardContextValue>(
    () => ({ currentStep, goToStep, goToNextStep, goToPreviousStep }),
    [currentStep, goToStep, goToNextStep, goToPreviousStep],
  )

  const isPayment = currentStep === PRO_UPGRADE_STEP.PAYMENT
  const stepperStep = isPayment
    ? 0
    : STEPPER_STEPS.findIndex(({ step }) => step === currentStep) + 1

  return (
    <ProUpgradeWizardContext.Provider value={contextValue}>
      <WizardChrome stepperStep={stepperStep} cardless={isPayment}>
        {children}
      </WizardChrome>
    </ProUpgradeWizardContext.Provider>
  )
}

export default ProUpgradeWizard
