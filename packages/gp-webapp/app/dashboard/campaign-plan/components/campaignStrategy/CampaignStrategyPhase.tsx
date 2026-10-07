'use client'

import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  InfoIcon,
  cn,
} from '@styleguide'
import type { TrackerTaskSkipReason } from '@goodparty_org/contracts'
import type {
  CampaignStrategyPhase as CampaignStrategyPhaseModel,
  CampaignStrategyTask,
} from './campaignStrategy.types'
import CampaignStrategyTaskRow from './CampaignStrategyTaskRow'

interface CampaignStrategyPhaseProps {
  phase: CampaignStrategyPhaseModel
  onToggleComplete?: (id: string, completed: boolean) => void
  onStartOutreach?: (
    channel: 'text' | 'robocall',
    date: string | null,
    taskId: string,
  ) => void
  onDiscuss?: (task: CampaignStrategyTask) => void
  getAction?: (
    task: CampaignStrategyTask,
  ) => { label: string; href: string; external: boolean } | null
  onSetAside?: (
    task: CampaignStrategyTask,
    reason: TrackerTaskSkipReason | null,
  ) => void
}

// Only a finished phase says so, in plain green text. The phase happening now
// is the one that opens on arrival, which says it without a label.
export const PhaseStatus = ({
  status,
}: {
  status: CampaignStrategyPhaseModel['status']
}): React.JSX.Element | null =>
  status === 'done' ? (
    <span className="text-success-700 text-sm font-semibold">Done</span>
  ) : null

// One phase as a section of the timeline card. Title and summary stay visible when collapsed; objective/category groups and task rows
// run edge to edge so dividers and highlights reach the card sides.
const CampaignStrategyPhase = ({
  phase,
  onToggleComplete,
  onStartOutreach,
  onDiscuss,
  getAction,
  onSetAside,
}: CampaignStrategyPhaseProps): React.JSX.Element => (
  <AccordionItem
    id={`phase-${phase.key}`}
    value={phase.key}
    className="overflow-hidden px-0"
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
      {phase.gate?.kind === 'window' ? (
        <div className="border-border border-t px-6 py-4">
          <div className="bg-primary/10 text-primary flex items-start gap-2 rounded-lg px-4 py-3 text-sm">
            <InfoIcon className="mt-0.5 size-4 shrink-0" />
            {phase.gate.message}
          </div>
        </div>
      ) : (
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
              {group.tasks.map((task) => (
                <CampaignStrategyTaskRow
                  key={task.id}
                  task={task}
                  onToggleComplete={onToggleComplete}
                  onStartOutreach={onStartOutreach}
                  onDiscuss={onDiscuss}
                  getAction={getAction}
                  onSetAside={onSetAside}
                />
              ))}
            </ul>
          </div>
        ))
      )}
    </AccordionContent>
  </AccordionItem>
)

export default CampaignStrategyPhase
