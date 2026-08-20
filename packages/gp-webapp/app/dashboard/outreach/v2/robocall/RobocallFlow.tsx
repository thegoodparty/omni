'use client'

import { useEffect, useState } from 'react'
import { OutreachFlowShell } from '../OutreachFlowShell'
import { type RobocallPurpose } from '../robocallPurposes'
import { RobocallPurposeStep } from './RobocallPurposeStep'

// Steps grow as later slices land (audience, schedule, record/compliance,
// review + pay). For now the flow proves the shell/tile-swap wiring: pick a
// purpose, then a placeholder for the not-yet-built remainder.
type StepId = 'purpose' | 'placeholder'
const STEP_ORDER: StepId[] = ['purpose', 'placeholder']

const STEP_TITLES: Record<StepId, string> = {
  purpose: 'What do you want to do?',
  placeholder: 'Robocall is coming soon',
}

interface RobocallFlowProps {
  open: boolean
  onClose: () => void
}

// Flow state is flat client state owned here (phase 1 TDD pattern): no server
// drafts, reopening starts fresh. Mirrors SocialFlow.
export const RobocallFlow = ({ open, onClose }: RobocallFlowProps) => {
  const [stepId, setStepId] = useState<StepId>('purpose')
  const [purpose, setPurpose] = useState<RobocallPurpose | null>(null)

  // Fresh flow every open — a cancelled-then-reopened flow must not resume.
  useEffect(() => {
    if (!open) return
    setStepId('purpose')
    setPurpose(null)
  }, [open])

  const stepIndex = STEP_ORDER.indexOf(stepId)

  const handleSelectPurpose = (selected: RobocallPurpose) => {
    setPurpose(selected)
    setStepId('placeholder')
  }

  const handleBack = () => {
    const previous = STEP_ORDER[stepIndex - 1]
    if (previous) setStepId(previous)
  }

  const dirty = purpose !== null

  return (
    <OutreachFlowShell
      open={open}
      onClose={onClose}
      title={STEP_TITLES[stepId]}
      currentStep={stepIndex + 1}
      totalSteps={STEP_ORDER.length}
      onBack={stepIndex > 0 ? handleBack : undefined}
      cta={null}
      dirty={dirty}
    >
      {stepId === 'purpose' ? (
        <RobocallPurposeStep
          selected={purpose}
          onSelect={handleSelectPurpose}
        />
      ) : (
        <div className="space-y-2 py-8 text-center">
          <h3 className="text-xl font-semibold text-foreground">
            More coming soon
          </h3>
          <p className="text-base text-muted-foreground">
            The rest of the robocall flow (audience, schedule, recording, and
            payment) is still being built.
          </p>
        </div>
      )}
    </OutreachFlowShell>
  )
}
