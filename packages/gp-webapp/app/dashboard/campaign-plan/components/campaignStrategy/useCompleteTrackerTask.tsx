'use client'

import { useState } from 'react'
import type { CampaignTrackerTask } from 'gpApi/api-endpoints'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { CampaignStrategyPhaseKeySchema } from '@goodparty_org/contracts'
import {
  outreachChannel,
  outreachEventProps,
  type OutreachTrackerOrigin,
} from 'app/dashboard/outreach/util/outreachAnalytics'
import CountModal from '../../../components/tasks/CountModal'
import {
  isVoterContactFlowType,
  useToggleTrackerTaskComplete,
} from './useTrackerTasks'

// Both halves or neither — a phase with no task id names nothing joinable.
// `phase` is a free `String?` on the row, so it is parsed against the contract
// rather than trusted.
export const trackerOrigin = (
  taskId: string,
  phase: string | null | undefined,
): OutreachTrackerOrigin | undefined => {
  const parsed = CampaignStrategyPhaseKeySchema.safeParse(phase)
  return parsed.success
    ? { trackerTaskId: taskId, phase: parsed.data }
    : undefined
}

// Task completion, shared by the tracker rail and the next-task card so both
// complete a task the same way. Completing an outreach/community-event task
// first asks how many voters were reached (legacy behavior); the count is
// recorded with the completion. Uncompleting, and completing anything else,
// goes straight through.
// Task completion is the primary activation metric and fired from nowhere
// between the legacy dashboard checklist's deletion and this: the tracker
// shipped with a completion toggle and no event at all. `trackerTaskId` is
// what joins a completed task to the outreach it produced — see
// docs/features/voter-outreach-analytics.md.
// Where a task action was taken: Home's card (`campaign_manager`, the same
// value the outreach flows use for Home) or the plan page.
export type TaskActionSource = 'campaign_manager' | 'campaign_plan'

export type TaskAction =
  | 'start'
  | 'ask'
  | 'put_off'
  | 'not_for_me'
  | 'bring_back'
  | 'mark_not_done'

// The one place a non-completion task choice is recorded, so Home and the
// plan report it in the same shape. Completion has its own event above.
export const trackTaskAction = (
  task: CampaignTrackerTask | undefined,
  action: TaskAction,
  source: TaskActionSource,
  cta?: string,
): void => {
  if (!task) return
  trackEvent(EVENTS.Dashboard.CampaignPlan.TaskActionTaken, {
    trackerTaskId: task.id,
    medium: outreachChannel(task.flowType ?? ''),
    ...(task.phase ? { phase: task.phase } : {}),
    action,
    source,
    ...(cta ? { cta } : {}),
  })
}

export const useCompleteTrackerTask = (
  tasks: CampaignTrackerTask[],
  {
    source,
    onCompleted,
  }: {
    // Which page the completion happened on.
    source: TaskActionSource
    // Called once a completion is committed (after the count, for outreach),
    // so a surface can celebrate it. Never for a cancelled count.
    onCompleted?: (id: string) => void
  },
): {
  onToggleComplete: (id: string, completed: boolean) => void
  countModal: React.JSX.Element | null
} => {
  const toggleComplete = useToggleTrackerTaskComplete()
  // An outreach task pending its voter-contact count in the modal.
  const [countTask, setCountTask] = useState<CampaignTrackerTask | null>(null)

  const trackTaskCompleted = (task: CampaignTrackerTask) => {
    trackEvent(EVENTS.Dashboard.CampaignPlan.TaskCompleted, {
      trackerTaskId: task.id,
      medium: outreachChannel(task.flowType ?? ''),
      ...(task.phase ? { phase: task.phase } : {}),
      source,
    })
  }

  const onToggleComplete = (id: string, completed: boolean) => {
    const task = tasks.find((t) => t.id === id)
    if (completed && task && isVoterContactFlowType(task.flowType)) {
      // The count modal is the rest of this completion, so the event rides
      // `onCountSubmit` instead — firing here too would count the task twice,
      // and once before the candidate can still cancel out of the modal.
      setCountTask(task)
      return
    }
    // Completion only. Un-completing is a correction, not an activation
    // signal, and an event named Completed must not fire on one.
    if (task && completed) trackTaskCompleted(task)
    toggleComplete.mutate({ id, completed })
    if (completed) onCompleted?.(id)
  }

  const onCountSubmit = (count: number) => {
    if (!countTask?.flowType) return
    trackTaskCompleted(countTask)
    // The count modal is a manual outreach log: the candidate is reporting
    // voters they reached offline on this task's channel. Same event the
    // campaign-manager modal fires, so both manual paths land in one series.
    // No `price` — nothing here captures a cost.
    trackEvent(EVENTS.Dashboard.VoterContact.CampaignCompleted, {
      ...outreachEventProps({
        channel: outreachChannel(countTask.flowType),
        isServe: false,
        recipientCount: count,
        sendDate: new Date(),
        ...(trackerOrigin(countTask.id, countTask.phase)
          ? { tracker: trackerOrigin(countTask.id, countTask.phase) }
          : {}),
      }),
      method: 'manual',
    })
    toggleComplete.mutate({
      id: countTask.id,
      completed: true,
      type: countTask.flowType,
      quantity: count,
    })
    onCompleted?.(countTask.id)
    setCountTask(null)
  }

  const countModal = countTask ? (
    <CountModal
      open
      onOpenChange={(next) => {
        if (!next) setCountTask(null)
      }}
      flowType={countTask.flowType ?? ''}
      onSubmit={onCountSubmit}
    />
  ) : null

  return { onToggleComplete, countModal }
}
