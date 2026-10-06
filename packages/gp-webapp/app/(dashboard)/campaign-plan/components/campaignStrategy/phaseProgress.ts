import type {
  CampaignStrategyPhase,
  CampaignStrategyTask,
} from './campaignStrategy.types'

// Every task a phase holds, whether it renders as groups or (Active) as weeks.
export const phaseTasks = (
  phase: CampaignStrategyPhase,
): CampaignStrategyTask[] =>
  phase.weeks
    ? phase.weeks.flatMap((week) => week.tasks)
    : phase.groups.flatMap((group) => group.tasks)

// A task counts as handled once it is done or set aside as not for me, the
// same rule that marks a whole phase done.
const isHandled = (task: CampaignStrategyTask): boolean =>
  task.completed || task.skipReason === 'notForMe'

export const phaseCounts = (
  phase: CampaignStrategyPhase,
): { done: number; total: number } => {
  const tasks = phaseTasks(phase)
  return { done: tasks.filter(isHandled).length, total: tasks.length }
}

export const phaseHasNext = (phase: CampaignStrategyPhase): boolean =>
  phaseTasks(phase).some((task) => task.isNext)
