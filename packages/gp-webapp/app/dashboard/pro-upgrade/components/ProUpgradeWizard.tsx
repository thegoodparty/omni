'use client'

import { useCallback, useEffect, useMemo } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { CAMPAIGN_VERIFICATION_PATH } from 'app/dashboard/campaign-verification/campaignVerificationPath'
import { useSmsCompliance } from 'app/dashboard/shared/smsCutoff/useSmsCompliance'
import {
  FullScreenStepChrome,
  type StepPosition,
} from 'app/dashboard/shared/FullScreenStepChrome'
import {
  PRO_UPGRADE_BASE_PATH,
  PRO_UPGRADE_STEP,
  PRO_UPGRADE_STEP_ORDER,
  proUpgradeStepPath,
  type ProUpgradeStep,
} from '../proUpgradeStep'
import {
  ProUpgradeWizardContext,
  useProUpgradeWizard,
  type ProUpgradeWizardContextValue,
} from './proUpgradeWizardContext'

export { useProUpgradeWizard }

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

// Design: renderSgModal — the same chrome the outreach sheet draws around the
// embedded flow (FullScreenStepChrome), with the bar stepper over the six
// ordered steps.
// The filing-instructions dead end reads as the status step it branches
// from, and the success screen draws no header at all.
const stepPosition = (step: ProUpgradeStep | null): StepPosition | null => {
  if (step === null || step === PRO_UPGRADE_STEP.SUCCESS) return null
  const anchor =
    step === PRO_UPGRADE_STEP.FILING_INSTRUCTIONS
      ? PRO_UPGRADE_STEP.STATUS
      : step
  const index = PRO_UPGRADE_STEP_ORDER.indexOf(anchor)
  if (index < 0) return null
  return { currentStep: index + 1, totalSteps: PRO_UPGRADE_STEP_ORDER.length }
}

interface ProUpgradeWizardProps {
  children: React.ReactNode
}

const ProUpgradeWizard = ({
  children,
}: ProUpgradeWizardProps): React.JSX.Element => {
  const router = useRouter()
  const pathname = usePathname()
  const stepOrder = PRO_UPGRADE_STEP_ORDER
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
    // The off-order filing-instructions route is only ever entered from the
    // filing-status step, so Back targets it explicitly: router.back() would
    // leave the wizard entirely for a candidate who arrived via a direct URL
    // (bookmark, emailed link). Guidance is the first ordered step, so it
    // falls through to router.back() instead.
    if (currentStep === PRO_UPGRADE_STEP.FILING_INSTRUCTIONS) {
      router.push(proUpgradeStepPath(PRO_UPGRADE_STEP.STATUS))
    } else if (orderIndex > 0) {
      router.push(proUpgradeStepPath(stepOrder[orderIndex - 1]!))
    } else {
      router.back()
    }
  }, [currentStep, orderIndex, stepOrder, router])

  const exit = useCallback(() => router.push('/dashboard'), [router])
  const handleChromeExit = useCallback(() => {
    trackEvent(EVENTS.ProUpgrade.ClickExit, { pathname })
    router.push('/dashboard')
  }, [pathname, router])

  // Completing hands off to campaign verification instead of the
  // dashboard: an already-Pro candidate who never submitted their filing is
  // routed to the success step, and finishes it there. The success step
  // exits instead once a filing is in. Once texting has closed there is no
  // verification to finish, so the candidate goes to the dashboard.
  const smsClosed = useSmsCompliance().smsCompliance === 'closed'
  const complete = useCallback(
    () => router.push(smsClosed ? '/dashboard' : CAMPAIGN_VERIFICATION_PATH),
    [smsClosed, router],
  )

  const contextValue = useMemo<ProUpgradeWizardContextValue>(
    () => ({
      currentStep,
      channel: null,
      goToStep,
      goToNextStep,
      goToPreviousStep,
      exit,
      complete,
    }),
    [currentStep, goToStep, goToNextStep, goToPreviousStep, exit, complete],
  )

  return (
    <ProUpgradeWizardContext.Provider value={contextValue}>
      <FullScreenStepChrome
        overline="Upgrade to Pro"
        position={stepPosition(currentStep)}
        onExit={handleChromeExit}
      >
        {children}
      </FullScreenStepChrome>
    </ProUpgradeWizardContext.Provider>
  )
}

export default ProUpgradeWizard
