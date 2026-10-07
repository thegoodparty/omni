'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useCampaign } from '@shared/hooks/useCampaign'
import { Accordion, EmptyState, Progress, Spinner, cn } from '@styleguide'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { buildTrackerStrategy } from './buildTrackerStrategy'
import { useSetTrackerTaskAside, useTrackerTasks } from './useTrackerTasks'
import { trackerOrigin, useCompleteTrackerTask } from './useCompleteTrackerTask'
import CampaignStrategyPhase from './CampaignStrategyPhase'
import { useNewTrackerTasks } from './useNewTrackerTasks'
import {
  discussTaskMessage,
  taskAction,
  useHeadStartWeek,
} from './NextTaskCard'
import { useCampaignManagerChat } from 'app/dashboard/campaign-manager/CampaignManagerChatProvider'
import { composeOutreachHref } from 'app/dashboard/outreach/util/composeOutreachHref.util'
import { CampaignStrategyPhaseKeySchema } from '@goodparty_org/contracts'

// The "Campaign Tracker" section on the campaign plan page: the persisted
// campaign-tracker rows (campaign_tracker_tasks) rendered as a four-phase,
// dated, prioritized list of cards. The tracker only exists once a campaign
// has gone through campaign story, so this section is rendered only for the
// story cohort (see CampaignPlanView) — there is no client-catalog fallback.
// While the tracker is bootstrapping (no rows yet) it shows a setup state.
const CampaignStrategySection = ({
  bodyStart,
}: {
  // Rendered above the timeline card (the Campaign strategy card).
  bodyStart?: React.ReactNode
}): React.JSX.Element => {
  const [campaign] = useCampaign()
  const { tasks, isPending, isError } = useTrackerTasks()
  const router = useRouter()
  // "Start outreach" links into the hub rather than opening a flow here: the
  // hub owns the one mount of each channel flow and the gate in front of it,
  // and it carries the task's due date onto the outreach record.
  const openOutreachFlow = useCallback(
    (channel: 'text' | 'robocall', date: string | null, taskId: string) => {
      const task = tasks.find((row) => row.id === taskId)
      router.push(
        composeOutreachHref(
          channel,
          'campaign_tracker',
          date,
          trackerOrigin(taskId, task?.phase),
        ),
      )
    },
    [router, tasks],
  )
  const { onToggleComplete, countModal } = useCompleteTrackerTask(tasks)
  const chat = useCampaignManagerChat()
  const setAside = useSetTrackerTaskAside()

  const metrics = campaign?.raceTargetMetrics
  const electionDateIso =
    metrics?.relevantElectionDate ??
    metrics?.generalElectionDate ??
    campaign?.details?.electionDate ??
    campaign?.electionDate ??
    null

  // Next week pulled forward from the next-step card, so the list marks the
  // same next task and its week navigator opens there.
  const headStartWeek = useHeadStartWeek()
  // Tasks that arrived in the background since the plan was last shown: the
  // candidate is told what was added, and the rows say New for this visit.
  const newTaskIds = useNewTrackerTasks(tasks, campaign?.id, { markSeen: true })
  // Render only from persisted rows. null until the first generation lands.
  const strategy = useMemo(() => {
    if (tasks.length === 0) return null
    const electionDate = electionDateIso
      ? new Date(electionDateIso.replace(/-/g, '/'))
      : null
    const built = buildTrackerStrategy(tasks, { electionDate, headStartWeek })
    for (const phase of built.phases) {
      for (const task of [
        ...phase.groups.flatMap((group) => group.tasks),
        ...(phase.weeks ?? []).flatMap((week) => week.tasks),
      ]) {
        task.isNew = newTaskIds.has(task.id)
      }
    }
    return built
  }, [tasks, electionDateIso, headStartWeek, newTaskIds])

  // Fires only once `strategy` exists, so it means "the candidate actually saw
  // their tasks" — not merely that the route loaded (the page view already
  // covers that, and it can't tell the rendered tracker from the loading,
  // error, or still-bootstrapping states). A candidate who reads their static
  // rows and leaves before the dynamic ones land still saw the tracker, so this
  // deliberately does not wait for `isGeneratingDynamic` to clear; `taskCount`
  // is what distinguishes a static-only view from a fully populated one.
  //
  // Guarded once per *mount*, not once per campaign. The ref only exists to
  // swallow the hook's poll-driven re-renders within a single visit — a later
  // visit is a real second view and must fire again, or the event can't measure
  // return engagement at all. So this deliberately does not use the
  // module-scoped Map that `CampaignPlanView` keeps for its resource-lifecycle
  // events: those describe one generation per page load, this describes a view.
  const trackedCampaignRef = useRef<number | null>(null)
  useEffect(() => {
    if (!strategy || !campaign?.id) return
    if (trackedCampaignRef.current === campaign.id) return
    trackedCampaignRef.current = campaign.id
    // Every phase lists its tasks in `groups`, the Active phase included.
    const rendered = strategy.phases.flatMap((phase) =>
      phase.groups.flatMap((group) => group.tasks),
    )
    trackEvent(EVENTS.Dashboard.CampaignPlan.CampaignTrackerViewed, {
      taskCount: rendered.length,
      tasksCompleted: rendered.filter((task) => task.completed).length,
      activePhase:
        strategy.phases.find((phase) => phase.status === 'active')?.key ??
        'none',
    })
  }, [strategy, campaign?.id])

  // The phase in focus opens on arrival: the one "happening now", unless a
  // link names another (`?phase=launch`). Every other phase starts closed.
  const linkedPhase = CampaignStrategyPhaseKeySchema.safeParse(
    typeof window === 'undefined'
      ? null
      : new URLSearchParams(window.location.search).get('phase'),
  )
  const phases = strategy?.phases ?? []
  const currentIndex = Math.max(
    0,
    phases.findIndex((phase) => phase.status === 'active'),
  )
  const focusKey =
    linkedPhase.success &&
    phases.some((phase) => phase.key === linkedPhase.data)
      ? linkedPhase.data
      : phases[currentIndex]?.key
  const [openKeys, setOpenKeys] = useState<string[] | null>(null)
  const openValue = openKeys ?? (focusKey ? [focusKey] : [])

  // On arrival, bring the "Do this next" row into view so the candidate lands
  // on what to do now; fall back to the phase in focus. Once per mount.
  const scrolledRef = useRef(false)
  useEffect(() => {
    if (scrolledRef.current || !strategy) return
    scrolledRef.current = true
    requestAnimationFrame(() => {
      const target =
        document.querySelector('[data-next-task="true"]') ??
        (focusKey ? document.getElementById(`phase-${focusKey}`) : null)
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }, [strategy, focusKey])

  return (
    <section>
      {isPending ? (
        <div className="mt-12 flex justify-center">
          <Spinner />
        </div>
      ) : isError ? (
        <EmptyState
          className="mx-4 mt-6 rounded-2xl border-components-input-border sm:mx-auto sm:max-w-[calc(48rem-2rem)]"
          message="We couldn’t load your tasks. Refresh the page to try again."
        />
      ) : !strategy ? (
        // The plan is being made: no tasks exist yet. The first ones land in
        // seconds to minutes, and the page polls, so they appear on their own.
        <EmptyState
          className="mx-4 mt-6 rounded-2xl border-components-input-border sm:mx-auto sm:max-w-[calc(48rem-2rem)]"
          icon={<Spinner />}
          title="Your campaign plan is being created"
          message="This takes a few minutes. Your tasks will show up here on their own."
        />
      ) : (
        <>
          <div className="mx-auto w-full max-w-3xl px-4 pt-6 pb-10">
            {bodyStart}
            {/* One long card: the timeline bar at its top, sticking as the
                phases scroll under it, each phase labelled and the current
                one called out. */}
            <div className="bg-card rounded-xl border">
              <div className="bg-card sticky top-0 z-20 rounded-t-xl border-b border-border px-6 pt-5 pb-4">
                {/* One progress bar per phase, filled by the share of its
                    tasks that are done (not-for-me tasks don't count against
                    it); the phase happening now keeps its bold label. */}
                <ol
                  className="grid gap-3"
                  style={{
                    gridTemplateColumns: `repeat(${phases.length}, minmax(0, 1fr))`,
                  }}
                >
                  {phases.map((phase, index) => {
                    const counted = phase.groups
                      .flatMap((group) => group.tasks)
                      .filter((task) => task.setAside === null)
                    const done = counted.filter((task) => task.completed).length
                    return (
                      <li
                        key={phase.key}
                        aria-current={
                          index === currentIndex ? 'step' : undefined
                        }
                        className="flex min-w-0 flex-col gap-2"
                      >
                        <Progress
                          value={
                            counted.length > 0
                              ? (done / counted.length) * 100
                              : 0
                          }
                          aria-label={`${phase.title}: ${done} of ${counted.length} done`}
                          className="h-2"
                        />
                        <span
                          className={cn(
                            'truncate text-xs',
                            index === currentIndex
                              ? 'font-semibold text-primary'
                              : index < currentIndex
                                ? 'text-foreground'
                                : 'text-muted-foreground',
                          )}
                        >
                          {phase.title}
                        </span>
                      </li>
                    )
                  })}
                </ol>
              </div>
              <Accordion
                type="multiple"
                value={openValue}
                onValueChange={setOpenKeys}
              >
                {phases.map((phase) => (
                  <CampaignStrategyPhase
                    key={phase.key}
                    phase={phase}
                    onToggleComplete={onToggleComplete}
                    onStartOutreach={openOutreachFlow}
                    getAction={(task) =>
                      taskAction(
                        tasks.find((row) => row.id === task.id),
                        'plan',
                      )
                    }
                    onSetAside={(task, reason) =>
                      setAside.mutate({ id: task.id, reason })
                    }
                    onDiscuss={
                      chat
                        ? (task) => chat.discussTask(discussTaskMessage(task))
                        : undefined
                    }
                  />
                ))}
              </Accordion>
            </div>
          </div>
        </>
      )}

      {countModal}
    </section>
  )
}

export default CampaignStrategySection
