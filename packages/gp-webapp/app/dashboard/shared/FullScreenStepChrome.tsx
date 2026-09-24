import { Stepper } from '@styleguide'

export interface StepPosition {
  currentStep: number
  totalSteps: number
}

interface FullScreenStepChromeProps {
  overline: string
  // null draws no header at all (design: the paid and pending screens).
  position: StepPosition | null
  onExit: () => void
  children: React.ReactNode
}

// Design: renderSgModal — the full-screen chrome the outreach sheet draws
// around the embedded Pro and verification flows, here for the standalone
// routes so both doors into a flow look the same: the overline with an Exit
// button over the bar stepper, then a 608px column the step stretches into so
// its footer pins to the bottom.
export const FullScreenStepChrome = ({
  overline,
  position,
  onExit,
  children,
}: FullScreenStepChromeProps): React.JSX.Element => (
  <div className="flex h-dvh flex-col bg-white">
    {position && (
      <div className="shrink-0 px-6 pt-6 pb-4">
        <div className="mx-auto w-full max-w-[608px]">
          <Stepper
            variant="bar"
            overline={overline}
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
