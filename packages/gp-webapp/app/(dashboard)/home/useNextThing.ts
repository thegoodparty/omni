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
import { PHASE_META } from '../campaign-plan/components/campaignStrategy/buildTrackerStrategy'

// How many slivers show behind the next thing. Two is enough to say "more are
// queued" without competing with the card in front.
const QUEUE_PEEK = 2

export interface NextThingProgress {
  step: number
  total: number
  phaseTitle: string
}

const phaseKey = (phase: string | null): string =>
  PHASE_META.some((p) => p.key === phase) ? (phase as string) : 'preLaunch'

// Where the next thing sits in its phase, over the tasks the plan shows now
// (static rows plus the latest AI generation): "Step 2 of 6 · Pre-launch".
const progressFor = (
  next: CampaignTrackerTask,
  tasks: CampaignTrackerTask[],
): NextThingProgress => {
  const dynamicWeeks = tasks.filter((t) => !t.isDefaultTask).map((t) => t.week)
  const latest = dynamicWeeks.length ? Math.max(...dynamicWeeks) : null
  const phase = phaseKey(next.phase)
  const inPhase = tasks.filter(
    (t) =>
      phaseKey(t.phase) === phase &&
      (t.isDefaultTask || latest === null || t.week === latest),
  )
  const settled = inPhase.filter(
    (t) => t.completed || t.skipReason === 'notForMe',
  ).length
  return {
    step: Math.min(settled + 1, inPhase.length),
    total: inPhase.length,
    phaseTitle: PHASE_META.find((p) => p.key === phase)?.title ?? '',
  }
}

// The one next thing and the queue behind it, shared by Home's card and its
// chat box so both are about the same task.
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
  const queue = ranked.slice(1, 1 + QUEUE_PEEK)
  const remaining = Math.max(ranked.length - 1, 0)
  const needsFiling = Boolean(next && !onBallot && isBallotAccessTask(next))

  const progress = useMemo(
    () => (next ? progressFor(next, tasks) : null),
    [next, tasks],
  )

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
    queue,
    remaining,
    progress,
    needsFiling,
    eventProps,
  }
}
