'use client'

import { useCallback, useMemo, useState } from 'react'
import {
  PRO_UPGRADE_STEP,
  proUpgradeStepOrder,
  type ProUpgradeStep,
} from '../proUpgradeStep'
import {
  ProUpgradeWizardContext,
  type ProUpgradeLaunchChannel,
  type ProUpgradeWizardContextValue,
} from './proUpgradeWizardContext'
import { PRO_UPGRADE_STEP_COMPONENTS } from './proUpgradeStepComponents'

interface ProUpgradeFlowProps {
  initialStep: ProUpgradeStep
  channel?: ProUpgradeLaunchChannel
  onExit: () => void
  onComplete: () => void
}

// State-driven twin of the route-based ProUpgradeWizard, for mounting the
// same step components inside another surface (the outreach sheet). Always
// purchase-only: it only exists under outreach-pro-gating-v2.
export const ProUpgradeFlow = ({
  initialStep,
  channel,
  onExit,
  onComplete,
}: ProUpgradeFlowProps): React.JSX.Element => {
  const [currentStep, setCurrentStep] = useState<ProUpgradeStep>(initialStep)
  const stepOrder = proUpgradeStepOrder(true)
  const orderIndex = stepOrder.indexOf(currentStep)

  const goToNextStep = useCallback(() => {
    if (orderIndex < 0 || orderIndex >= stepOrder.length - 1) return
    setCurrentStep(stepOrder[orderIndex + 1]!)
  }, [orderIndex, stepOrder])

  const goToPreviousStep = useCallback(() => {
    if (currentStep === PRO_UPGRADE_STEP.FILING_INSTRUCTIONS) {
      setCurrentStep(PRO_UPGRADE_STEP.STATUS)
      return
    }
    if (orderIndex > 0) setCurrentStep(stepOrder[orderIndex - 1]!)
    else onExit()
  }, [currentStep, orderIndex, stepOrder, onExit])

  const value = useMemo<ProUpgradeWizardContextValue>(
    () => ({
      currentStep,
      purchaseOnly: true,
      channel: channel ?? null,
      goToStep: setCurrentStep,
      goToNextStep,
      goToPreviousStep,
      exit: onExit,
      complete: onComplete,
    }),
    [currentStep, channel, goToNextStep, goToPreviousStep, onExit, onComplete],
  )

  const StepComponent = PRO_UPGRADE_STEP_COMPONENTS[currentStep]

  return (
    <ProUpgradeWizardContext.Provider value={value}>
      <StepComponent />
    </ProUpgradeWizardContext.Provider>
  )
}

export default ProUpgradeFlow
