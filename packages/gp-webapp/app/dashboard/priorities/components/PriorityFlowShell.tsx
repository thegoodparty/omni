'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Label, Switch } from '@styleguide'
import { ChevronRightIcon } from '@styleguide/components/ui/icons'
import type { Priority } from '@goodparty_org/contracts'
import { ChatComposer } from '../../shared/agent-chat/chatUI'
import {
  PRIORITY_NEXT_STEP_CTA,
  nextPriorityStep,
  type PriorityFlowStep,
} from '../data/steps'
import PriorityStepper from './PriorityStepper'
import StepPanel from './StepPanel'

// The flow around one priority, in the ordinance flow's shell: a full-height
// column, the stepper and title scrolling away with the conversation, and the
// composer pinned to the bottom.
//
// Step state lives here for now. The flow's backend does not exist, so nothing
// is persisted and a reload starts over; once gp-api owns the record, `step`
// becomes a route segment the way ordinances/solve/[slug]/[step] does.
export default function PriorityFlowShell({
  priority,
}: {
  priority: Priority
}): React.JSX.Element {
  const router = useRouter()
  const [step, setStep] = useState<PriorityFlowStep>('define')
  const [composer, setComposer] = useState('')
  const [isPublic, setIsPublic] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const destination = nextPriorityStep(step)

  // House rule for multi-step flows: a step change puts the user back at the
  // top. The scroller is this component's, not the window's.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [step])

  return (
    <div className="flex h-[calc(100dvh-4rem)] w-full flex-col bg-background lg:h-dvh">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
          <header className="flex flex-col gap-3">
            <PriorityStepper current={step} />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h1 className="text-xl font-semibold text-foreground">
                {priority.title}
              </h1>
              {/* Visibility has no column on Priority yet, so this holds for
                  the session only. */}
              <div className="flex items-center gap-2">
                <Switch
                  id="priority-visibility"
                  checked={isPublic}
                  onCheckedChange={setIsPublic}
                />
                <Label
                  htmlFor="priority-visibility"
                  className="text-sm font-normal text-muted-foreground"
                >
                  {isPublic ? 'On your public page' : 'Just for you'}
                </Label>
              </div>
            </div>
          </header>

          <div className="flex flex-col gap-3">
            {/* The step owns when its advance row appears, the way the agent
                owns when it calls offer_next_step: the define step waits for
                both answers, the listening steps wait for a decision. */}
            <StepPanel
              step={step}
              advance={
                destination ? (
                  <NextStepButton
                    nextLabel={PRIORITY_NEXT_STEP_CTA[destination]}
                    onAdvance={() => setStep(destination)}
                  />
                ) : (
                  <NextStepButton
                    nextLabel="Back to your priorities"
                    onAdvance={() => router.push('/dashboard/priorities')}
                  />
                )
              }
            />
          </div>
        </div>
      </div>

      <div className="shrink-0 border-t border-border bg-background">
        <div className="mx-auto w-full max-w-3xl px-4 py-3">
          <ChatComposer
            value={composer}
            onChange={setComposer}
            onSubmit={() => setComposer('')}
            disabled
            placeholder="Chat opens up once this flow is wired to the agent"
          />
        </div>
      </div>
    </div>
  )
}

// The advance affordance the ordinance flow uses: a full-width row rather than
// a button, so it reads as the next thing in the conversation.
function NextStepButton({
  nextLabel,
  onAdvance,
}: {
  nextLabel: string
  onAdvance: () => void
}): React.JSX.Element {
  return (
    <Button
      type="button"
      variant="outline"
      onClick={onAdvance}
      className="h-auto w-full justify-between rounded-lg border-border bg-card px-4 py-3 text-sm text-foreground shadow-sm hover:border-foreground/20 hover:bg-muted/50 hover:text-foreground"
    >
      <span>{nextLabel}</span>
      <ChevronRightIcon
        className="size-4 shrink-0 text-muted-foreground"
        aria-hidden
      />
    </Button>
  )
}
