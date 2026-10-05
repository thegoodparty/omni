'use client'

import { useMemo } from 'react'
import { differenceInCalendarDays } from 'date-fns'
import {
  isBallotAccessTask,
  rankNextTrackerTasks,
} from '@goodparty_org/contracts'
import type { CampaignTrackerTask } from 'gpApi/api-endpoints'
import { useCampaign } from '@shared/hooks/useCampaign'
import { outreachChannel } from 'app/(dashboard)/outreach/util/outreachAnalytics'
import { useTrackerTasks } from '../campaign-plan/components/campaignStrategy/useTrackerTasks'

export interface NextThingProgress {
  done: number
  total: number
}

// How far along the whole plan is, over the tasks the plan shows now (static
// rows plus the latest AI generation). One count for the whole page: early
// on, pointing at what's already done motivates more than pointing at what's
// left.
const planProgress = (tasks: CampaignTrackerTask[]): NextThingProgress => {
  const dynamicWeeks = tasks.filter((t) => !t.isDefaultTask).map((t) => t.week)
  const latest = dynamicWeeks.length ? Math.max(...dynamicWeeks) : null
  const current = tasks.filter(
    (t) => t.isDefaultTask || latest === null || t.week === latest,
  )
  return {
    done: current.filter((t) => t.completed || t.skipReason === 'notForMe')
      .length,
    total: current.length,
  }
}

// The one next thing, shared by Home's headline, card and chat box so they
// are all about the same task.
export const useNextThing = () => {
  const { tasks, isPending, isError } = useTrackerTasks()
  const [campaign] = useCampaign()

  const onBallot = campaign?.ballotStatus === 'on-ballot'
  const metrics = campaign?.raceTargetMetrics
  const electionDateIso =
    metrics?.relevantElectionDate ??
    metrics?.generalElectionDate ??
    campaign?.details?.electionDate ??
    campaign?.electionDate ??
    null

  const ranked = useMemo(
    () =>
      rankNextTrackerTasks(tasks, {
        onBallot,
        electionDate: electionDateIso
          ? new Date(electionDateIso.replace(/-/g, '/'))
          : null,
        now: new Date(),
      }),
    [tasks, onBallot, electionDateIso],
  )

  const next = ranked[0] ?? null
  const needsFiling = Boolean(next && !onBallot && isBallotAccessTask(next))

  const progress = useMemo(() => planProgress(tasks), [tasks])

  const eventProps = useMemo(() => {
    if (!next) return null
    return {
      trackerTaskId: next.id,
      medium: outreachChannel(next.flowType ?? ''),
      ...(next.phase ? { phase: next.phase } : {}),
      candidateStage: campaign?.ballotStatus ?? 'unanswered',
      ...(electionDateIso
        ? {
            daysToElection: differenceInCalendarDays(
              new Date(electionDateIso.replace(/-/g, '/')),
              new Date(),
            ),
          }
        : {}),
      isBallotAccess: needsFiling,
    }
  }, [next, campaign?.ballotStatus, electionDateIso, needsFiling])

  return {
    tasks,
    isPending,
    isError,
    next,
    progress,
    needsFiling,
    eventProps,
  }
}
