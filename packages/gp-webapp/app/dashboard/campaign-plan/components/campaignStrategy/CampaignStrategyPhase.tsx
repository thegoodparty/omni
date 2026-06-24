'use client'

import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Badge,
  InfoIcon,
  cn,
} from '@styleguide'
import type { CampaignStrategyPhase as CampaignStrategyPhaseModel } from './campaignStrategy.types'
import CampaignStrategyTaskRow from './CampaignStrategyTaskRow'

interface CampaignStrategyPhaseProps {
  phase: CampaignStrategyPhaseModel
  onToggleComplete?: (id: string, completed: boolean) => void
}

// "Done" is plain green text; the other states are pills.
const PhaseStatus = ({
  status,
}: {
  status: CampaignStrategyPhaseModel['status']
}): React.JSX.Element => {
  if (status === 'done') {
    return <span className="text-success-700 text-sm font-semibold">Done</span>
  }
  if (status === 'active') {
    return (
      <Badge className="border-transparent bg-primary text-white">
        Happening now
      </Badge>
    )
  }
  return (
    <Badge className="text-muted-foreground border-border bg-transparent">
      Coming up
    </Badge>
  )
}

// One phase as a standalone card (active phase gets a blue border). Title and
// summary stay visible when collapsed; objective/category groups and task rows
// run edge to edge so dividers and highlights reach the card sides.
const CampaignStrategyPhase = ({
  phase,
  onToggleComplete,
}: CampaignStrategyPhaseProps): React.JSX.Element => (
  <AccordionItem
    value={phase.key}
    className={cn(
      'bg-card overflow-hidden rounded-xl border px-0 shadow-sm',
      phase.status === 'active' && 'border-primary',
    )}
  >
    <AccordionTrigger className="px-6 py-5 hover:no-underline">
      <span className="flex flex-1 flex-col gap-1 text-left">
        <span className="flex items-center gap-3">
          <span className="text-base font-semibold">{phase.title}</span>
          <PhaseStatus status={phase.status} />
        </span>
        <span className="text-muted-foreground text-sm font-normal">
          {phase.summary}
        </span>
      </span>
    </AccordionTrigger>
    <AccordionContent>
      {phase.gate?.kind === 'window' && (
        <div className="border-border border-t px-6 py-4">
          <div className="bg-primary/10 text-primary flex items-start gap-2 rounded-lg px-4 py-3 text-sm">
            <InfoIcon className="mt-0.5 size-4 shrink-0" />
            {phase.gate.message}
          </div>
        </div>
      )}
      {!phase.gate &&
        phase.groups.map((group) => (
          <div key={group.key}>
            {group.label && (
              <div className="bg-muted border-border border-t px-6 py-3">
                <p className="text-primary text-xs font-semibold tracking-wide uppercase">
                  {group.label}
                </p>
              </div>
            )}
            <ul className={cn(!group.label && 'border-border border-t')}>
              {group.tasks.map((task, index) => (
                <CampaignStrategyTaskRow
                  key={task.id}
                  task={task}
                  index={index + 1}
                  onToggleComplete={onToggleComplete}
                />
              ))}
            </ul>
          </div>
        ))}
      {!phase.gate && !!phase.hiddenCount && (
        <p className="text-muted-foreground border-border border-t px-6 py-4 text-sm">
          {phase.hiddenCount} more {phase.hiddenCount === 1 ? 'task' : 'tasks'}{' '}
          unlock as you complete these.
        </p>
      )}
    </AccordionContent>
  </AccordionItem>
)

export default CampaignStrategyPhase
