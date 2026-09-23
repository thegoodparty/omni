'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  PRO_UPGRADE_STEP,
  PRO_UPGRADE_STEP_ORDER_PURCHASE_ONLY,
  proUpgradeStepOrder,
  type ProUpgradeStep,
} from '../proUpgradeStep'
import {
  ProUpgradeWizardContext,
  type ProUpgradeLaunchChannel,
  type ProUpgradeWizardContextValue,
} from './proUpgradeWizardContext'
import { PRO_UPGRADE_STEP_COMPONENTS } from './proUpgradeStepComponents'

export interface ProUpgradeFlowPosition {
  // 1-based; totalSteps 0 means the step draws no header at all (design:
  // renderSgModal hides the overline and stepper on the pause and success
  // screens).
  currentStep: number
  totalSteps: number
}

interface ProUpgradeFlowProps {
  initialStep: ProUpgradeStep
  channel?: ProUpgradeLaunchChannel
  onExit: () => void
  onComplete: () => void
  // Where the wizard is, for a host that draws the stepper in its own
  // header (the outreach sheet). Must be referentially stable.
  onPositionChange?: (position: ProUpgradeFlowPosition) => void
}

// State-driven twin of the route-based ProUpgradeWizard, for mounting the
// same step components inside another surface (the outreach sheet). Always
// purchase-only: it only exists under outreach-pro-gating-v2.
export const ProUpgradeFlow = ({
  initialStep,
  channel,
  onExit,
  onComplete,
  onPositionChange,
}: ProUpgradeFlowProps): React.JSX.Element => {
  const [currentStep, setCurrentStep] = useState<ProUpgradeStep>(initialStep)
  const stepOrder = proUpgradeStepOrder(true)
  const orderIndex = stepOrder.indexOf(currentStep)

  useEffect(() => {
    if (!onPositionChange) return
    if (
      currentStep === PRO_UPGRADE_STEP.INTERSTITIAL ||
      currentStep === PRO_UPGRADE_STEP.SUCCESS
    ) {
      onPositionChange({ currentStep: 0, totalSteps: 0 })
      return
    }
    // The filing-instructions dead end is a branch off the status step, so
    // it reads as that step's position.
    const anchor =
      currentStep === PRO_UPGRADE_STEP.FILING_INSTRUCTIONS
        ? PRO_UPGRADE_STEP.STATUS
        : currentStep
    onPositionChange({
      currentStep: PRO_UPGRADE_STEP_ORDER_PURCHASE_ONLY.indexOf(anchor) + 1,
      totalSteps: PRO_UPGRADE_STEP_ORDER_PURCHASE_ONLY.length,
    })
  }, [currentStep, onPositionChange])

  const goToNextStep = useCallback(() => {
    // INTERSTITIAL has no place in the purchase-only order (it's only ever
    // an initialStep, never derived or ordered), so it can't resolve by
    // index — the wizard always continues from it into guidance.
    if (currentStep === PRO_UPGRADE_STEP.INTERSTITIAL) {
      setCurrentStep(PRO_UPGRADE_STEP.GUIDANCE)
      return
    }
    if (orderIndex < 0 || orderIndex >= stepOrder.length - 1) return
    setCurrentStep(stepOrder[orderIndex + 1]!)
  }, [currentStep, orderIndex, stepOrder])

  const goToPreviousStep = useCallback(() => {
    if (currentStep === PRO_UPGRADE_STEP.INTERSTITIAL) {
      onExit()
      return
    }
    // Inside an outreach flow the pitch stands in front of the wizard, so
    // Back off its first step returns to it; "Maybe later" there is the exit.
    if (currentStep === PRO_UPGRADE_STEP.GUIDANCE && channel) {
      setCurrentStep(PRO_UPGRADE_STEP.INTERSTITIAL)
      return
    }
    if (currentStep === PRO_UPGRADE_STEP.FILING_INSTRUCTIONS) {
      setCurrentStep(PRO_UPGRADE_STEP.STATUS)
      return
    }
    if (orderIndex > 0) setCurrentStep(stepOrder[orderIndex - 1]!)
    else onExit()
  }, [currentStep, orderIndex, stepOrder, onExit, channel])

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
      {/* Stretches to the host's column so a step can pin its footer row
          to the bottom of the sheet (design: renderSgModal's footerRow). */}
      <div className="flex min-h-full flex-1 flex-col">
        <StepComponent />
      </div>
    </ProUpgradeWizardContext.Provider>
  )
}

export default ProUpgradeFlow
