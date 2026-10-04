'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useCampaign } from '@shared/hooks/useCampaign'
import { Accordion, Button, Card } from '@styleguide'
import { IS_PROD } from 'appEnv'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { buildTrackerStrategy } from './buildTrackerStrategy'
import { useGenerateTrackerTasks, useTrackerTasks } from './useTrackerTasks'
import { trackerOrigin, useCompleteTrackerTask } from './useCompleteTrackerTask'
import CampaignStrategyPhase from './CampaignStrategyPhase'
import { composeOutreachHref } from 'app/dashboard/outreach/util/composeOutreachHref.util'
import { CampaignStrategyPhaseKeySchema } from '@goodparty_org/contracts'

// The "Campaign Tracker" section on the campaign plan page: the persisted
// campaign-tracker rows (campaign_tracker_tasks) rendered as a four-phase,
// dated, prioritized list of cards. The tracker only exists once a campaign
// has gone through campaign story, so this section is rendered only for the
// story cohort (see CampaignPlanView) — there is no client-catalog fallback.
// While the tracker is bootstrapping (no rows yet) it shows a setup state.
const CampaignStrategySection = (): React.JSX.Element => {
  const [campaign] = useCampaign()
  const { tasks, isPending, isError, isGeneratingDynamic } = useTrackerTasks()
  const { generate, isGenerating } = useGenerateTrackerTasks()
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

  const metrics = campaign?.raceTargetMetrics
  const electionDateIso =
    metrics?.relevantElectionDate ??
    metrics?.generalElectionDate ??
    campaign?.details?.electionDate ??
    campaign?.electionDate ??
    null

  // Render only from persisted rows. null until the first generation lands.
  const strategy = useMemo(() => {
    if (tasks.length === 0) return null
    const electionDate = electionDateIso
      ? new Date(electionDateIso.replace(/-/g, '/'))
      : null
    return buildTrackerStrategy(tasks, { electionDate })
  }, [tasks, electionDateIso])

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
    // The Active phase carries its tasks in `weeks` with `groups` emptied, and
    // its navigator opens on the current week (falling back to the last). Count
    // that one week rather than every week: `weeks` accumulates all generations,
    // so summing them would make taskCount climb week over week no matter what
    // the candidate is actually looking at.
    const rendered = strategy.phases.flatMap((phase) => {
      if (!phase.weeks) return phase.groups.flatMap((group) => group.tasks)
      const open =
        phase.weeks.find((week) => week.isCurrent) ??
        phase.weeks[phase.weeks.length - 1]
      return open?.tasks ?? []
    })
    trackEvent(EVENTS.Dashboard.CampaignPlan.CampaignTrackerViewed, {
      taskCount: rendered.length,
      tasksCompleted: rendered.filter((task) => task.completed).length,
      activePhase:
        strategy.phases.find((phase) => phase.status === 'active')?.key ??
        'none',
    })
  }, [strategy, campaign?.id])

  // Every phase starts closed: the next-task card above already shows what to
  // do now, so opening a phase here would only repeat it. A link can still
  // open one by naming it (`?phase=preLaunch`), for a surface that sends the
  // candidate to a specific phase.
  const linkedPhase = CampaignStrategyPhaseKeySchema.safeParse(
    typeof window === 'undefined'
      ? null
      : new URLSearchParams(window.location.search).get('phase'),
  )
  const defaultOpen =
    linkedPhase.success &&
    strategy?.phases.some((phase) => phase.key === linkedPhase.data)
      ? [linkedPhase.data]
      : []

  return (
    <section>
      {/* The section's title and intro sit above the progress card in
          CampaignPlanView, so only this non-prod trigger is left here. Prod
          generates via the weekly cron, but dev/qa have no cron, so this lets
          us dispatch a run on demand. gp-api 404s the route in prod as a
          backstop. */}
      {!IS_PROD && (
        <div className="mb-5 flex justify-start">
          <Button
            variant="outline"
            size="small"
            onClick={generate}
            loading={isGenerating}
            loadingText="Generating…"
            disabled={isPending}
          >
            Generate tasks
          </Button>
        </div>
      )}
      {isPending ? (
        <Card className="flex items-center gap-3 p-4">
          <div className="border-primary size-4 shrink-0 animate-spin rounded-full border-b-2" />
          <p className="text-muted-foreground text-sm">Loading your tasks…</p>
        </Card>
      ) : isError ? (
        <Card className="p-4">
          <p className="text-muted-foreground text-sm">
            We could not load your tasks just now. Refresh the page to try
            again.
          </p>
        </Card>
      ) : !strategy ? (
        // Plan just completed; the tracker is bootstrapping. Static rows land
        // first (seconds), then the dynamic tasks + events (a few minutes).
        <Card className="flex items-center gap-3 p-4">
          <div className="border-primary size-4 shrink-0 animate-spin rounded-full border-b-2" />
          <p className="text-muted-foreground text-sm">
            Setting up your campaign tracker. Your tasks will appear here
            automatically in a few minutes.
          </p>
        </Card>
      ) : (
        <>
          {(isGeneratingDynamic || isGenerating) && (
            <Card className="mb-4 flex items-center gap-3 p-4">
              <div className="border-primary size-4 shrink-0 animate-spin rounded-full border-b-2" />
              <p className="text-muted-foreground text-sm">
                Finding local events and personalizing the rest of your weekly
                tasks. They will appear here automatically in a few minutes.
              </p>
            </Card>
          )}
          <Accordion
            type="multiple"
            defaultValue={defaultOpen}
            className="space-y-4"
          >
            {strategy.phases.map((phase) => (
              <CampaignStrategyPhase
                key={phase.key}
                phase={phase}
                onToggleComplete={onToggleComplete}
                onStartOutreach={openOutreachFlow}
              />
            ))}
          </Accordion>
        </>
      )}

      {countModal}
    </section>
  )
}

export default CampaignStrategySection
