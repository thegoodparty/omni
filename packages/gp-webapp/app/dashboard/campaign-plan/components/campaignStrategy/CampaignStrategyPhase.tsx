'use client'

import { InfoIcon } from '@styleguide'
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
  onActionTaken?: (task: CampaignStrategyTask, label: string) => void
}

// One phase's body under its sticky heading: its rows.
// Objective/category groups and task rows run edge to edge so dividers and
// highlights reach the card sides.
const CampaignStrategyPhase = ({
  phase,
  onToggleComplete,
  onStartOutreach,
  onDiscuss,
  getAction,
  onSetAside,
  onActionTaken,
}: CampaignStrategyPhaseProps): React.JSX.Element => {
  const hasRows = phase.groups.some((group) => group.tasks.length > 0)
  return (
    <>
      {phase.gate?.kind === 'window' ? (
        <div className="px-6 py-4">
          <div className="bg-primary/10 text-primary flex items-start gap-2 rounded-lg px-4 py-3 text-sm">
            <InfoIcon className="mt-0.5 size-4 shrink-0" />
            {phase.gate.message}
          </div>
        </div>
      ) : !hasRows ? (
        <p className="text-muted-foreground px-6 py-4 text-sm">
          No tasks in this phase yet.
        </p>
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
            <ul>
              {group.tasks.map((task) => (
                <CampaignStrategyTaskRow
                  key={task.id}
                  task={task}
                  onToggleComplete={onToggleComplete}
                  onStartOutreach={onStartOutreach}
                  onDiscuss={onDiscuss}
                  getAction={getAction}
                  onSetAside={onSetAside}
                  onActionTaken={onActionTaken}
                />
              ))}
            </ul>
          </div>
        ))
      )}
    </>
  )
}

export default CampaignStrategyPhase
