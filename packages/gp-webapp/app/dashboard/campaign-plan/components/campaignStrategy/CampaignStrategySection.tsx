'use client'

import { Fragment, useCallback, useEffect, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useCampaign } from '@shared/hooks/useCampaign'
import { EmptyState, Progress, Spinner, cn } from '@styleguide'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { buildTrackerStrategy } from './buildTrackerStrategy'
import { useSetTrackerTaskAside, useTrackerTasks } from './useTrackerTasks'
import {
  trackTaskAction,
  trackerOrigin,
  useCompleteTrackerTask,
} from './useCompleteTrackerTask'
import CampaignStrategyPhase from './CampaignStrategyPhase'
import { useNewTrackerTasks } from './useNewTrackerTasks'
import {
  discussTaskMessage,
  taskAction,
  useHeadStartWeek,
} from './NextTaskCard'
import { useCampaignManagerChat } from 'app/dashboard/campaign-manager/CampaignManagerChatProvider'
import { composeOutreachHref } from 'app/dashboard/outreach/util/composeOutreachHref.util'
import {
  CampaignStrategyPhaseKeySchema,
  timelineElectionDate,
} from '@goodparty_org/contracts'

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
  const { onToggleComplete, countModal } = useCompleteTrackerTask(tasks, {
    source: 'campaign_plan',
  })
  const rowFor = (id: string) => tasks.find((row) => row.id === id)
  const chat = useCampaignManagerChat()
  const setAside = useSetTrackerTaskAside()

  // The same election gp-api dates the tasks from, so each task lands in the
  // phase its date belongs to.
  const electionDateIso = timelineElectionDate(
    {
      general: campaign?.details?.electionDate,
      primary: campaign?.details?.primaryElectionDate,
    },
    new Date(),
  )

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

  // A link can name a phase to land on (`?phase=gotv`).
  const linkedPhase = CampaignStrategyPhaseKeySchema.safeParse(
    typeof window === 'undefined'
      ? null
      : new URLSearchParams(window.location.search).get('phase'),
  )
  const phases = strategy?.phases ?? []
  const currentIndex = phases.findIndex((phase) => phase.status === 'active')
  // Each phase's bar measures its done tasks; not-for-me ones don't count
  // against it.
  const sections = phases.map((phase) => {
    const counted = phase.groups
      .flatMap((group) => group.tasks)
      .filter((task) => task.setAside === null)
    return {
      phase,
      total: counted.length,
      done: counted.filter((task) => task.completed).length,
    }
  })
  const jumpTo = (key: string) => {
    document
      .getElementById(`phase-${key}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // On arrival, go to the phase a link names, else bring the "Do this next"
  // row into view so the candidate lands on what to do now. Once per mount.
  const scrolledRef = useRef(false)
  useEffect(() => {
    if (scrolledRef.current || !strategy) return
    scrolledRef.current = true
    const linked = linkedPhase.success ? linkedPhase.data : null
    requestAnimationFrame(() => {
      if (linked) {
        document
          .getElementById(`phase-${linked}`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        return
      }
      document
        .querySelector('[data-next-task="true"]')
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }, [strategy, linkedPhase.success, linkedPhase.data])

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
            {/* One long card. Each phase is a heading that sticks to the
                top while its tasks scroll, and the phases still ahead wait
                at the bottom, tapped to jump there. */}
            <div className="bg-card rounded-xl border [--plan-phase:2.25rem] sm:[--plan-phase:2.75rem]">
              {sections.map((section, index) => (
                <Fragment key={section.phase.key}>
                  {/* Sticky at the top while its phase scrolls, and at the
                        bottom (stacked above the later ones) until it
                        arrives. Siblings, not nested in their sections, so
                        each can stick past its own phase. */}
                  <h3
                    className="sticky z-20"
                    style={{
                      top: 0,
                      bottom: `calc(var(--chat-dock-height, 0px) + ${sections.length - 1 - index} * var(--plan-phase))`,
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => jumpTo(section.phase.key)}
                      aria-label={`${section.phase.title}, ${section.done} of ${section.total} done`}
                      aria-current={index === currentIndex ? 'step' : undefined}
                      className={cn(
                        'bg-muted hover:shadow-[inset_0_0_0_9999px_rgb(0_0_0/0.04)] focus-visible:ring-primary-focus flex h-(--plan-phase) w-full items-center gap-4 border-y border-border px-4 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-inset sm:px-6',
                        // The first sits on the card's own top edge.
                        index === 0 && 'rounded-t-xl border-t-0',
                      )}
                    >
                      <span
                        className={cn(
                          'shrink-0 text-sm font-semibold',
                          index === currentIndex
                            ? 'text-primary'
                            : 'text-foreground',
                        )}
                      >
                        {section.phase.title}
                      </span>
                      <Progress
                        aria-hidden
                        value={
                          section.total > 0
                            ? (section.done / section.total) * 100
                            : 0
                        }
                        className="h-2 flex-1"
                      />
                    </button>
                  </h3>
                  <section
                    id={`phase-${section.phase.key}`}
                    aria-label={section.phase.title}
                    className="scroll-mt-(--plan-phase)"
                  >
                    <CampaignStrategyPhase
                      phase={section.phase}
                      onToggleComplete={(id, completed) => {
                        // Completing reports itself, with its source; an
                        // undo is a choice worth seeing too.
                        if (!completed) {
                          trackTaskAction(
                            rowFor(id),
                            'mark_not_done',
                            'campaign_plan',
                          )
                        }
                        onToggleComplete(id, completed)
                      }}
                      onStartOutreach={openOutreachFlow}
                      getAction={(task) => taskAction(rowFor(task.id), 'plan')}
                      onSetAside={(task, reason) => {
                        trackTaskAction(
                          rowFor(task.id),
                          reason === 'later'
                            ? 'put_off'
                            : reason === 'notForMe'
                              ? 'not_for_me'
                              : 'bring_back',
                          'campaign_plan',
                        )
                        setAside.mutate({ id: task.id, reason })
                      }}
                      onActionTaken={(task, label) =>
                        trackTaskAction(
                          rowFor(task.id),
                          'start',
                          'campaign_plan',
                          label,
                        )
                      }
                      onDiscuss={
                        chat
                          ? (task) => {
                              trackTaskAction(
                                rowFor(task.id),
                                'ask',
                                'campaign_plan',
                              )
                              chat.discussTask(discussTaskMessage(task))
                            }
                          : undefined
                      }
                    />
                  </section>
                </Fragment>
              ))}
            </div>
          </div>
        </>
      )}

      {countModal}
    </section>
  )
}

export default CampaignStrategySection
