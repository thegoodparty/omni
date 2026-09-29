import { useState } from 'react'
import { Stepper } from '@styleguide'
import { StepFooterSlotContext } from './StepFooter'

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
// button over the bar stepper, a 608px column that scrolls on its own, and a
// footer bar below it that the step's StepFooter buttons portal into.
export const FullScreenStepChrome = ({
  overline,
  position,
  onExit,
  children,
}: FullScreenStepChromeProps): React.JSX.Element => {
  const [footerSlot, setFooterSlot] = useState<HTMLDivElement | null>(null)

  return (
    <StepFooterSlotContext.Provider value={footerSlot}>
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
        {/* min-h-0: a flex child defaults to min-height:auto, so without it
            this column grows to its content and the window scrolls the header
            away instead of this body scrolling under it. relative: Radix
            Select keeps a hidden, absolutely positioned native <select> per
            dropdown, and an overflow box only clips positioned descendants
            it is the containing block for; without it those selects extend
            the page below the footer and the window scrolls again. */}
        <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-5">
          <div className="mx-auto flex w-full max-w-[608px] flex-1 flex-col">
            {children}
          </div>
        </div>
        {/* Hidden until a StepFooter has portaled into it. */}
        <div className="shrink-0 bg-white px-6 pt-3 pb-6 has-[>div:empty]:hidden">
          <div ref={setFooterSlot} className="mx-auto w-full max-w-[608px]" />
        </div>
      </div>
    </StepFooterSlotContext.Provider>
  )
}
