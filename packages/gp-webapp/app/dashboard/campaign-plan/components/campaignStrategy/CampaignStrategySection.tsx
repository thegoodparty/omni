'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useCampaign } from '@shared/hooks/useCampaign'
import { Accordion, Button, Card } from '@styleguide'
import type { CampaignTrackerTask } from 'gpApi/api-endpoints'
import { IS_PROD } from 'appEnv'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { buildTrackerStrategy } from './buildTrackerStrategy'
import {
  isVoterContactFlowType,
  useGenerateTrackerTasks,
  useToggleTrackerTaskComplete,
  useTrackerTasks,
} from './useTrackerTasks'
import CampaignStrategyPhase from './CampaignStrategyPhase'
import CountModal from '../../../components/tasks/CountModal'
import { useOutreachComposeFlow } from 'app/dashboard/outreach/hooks/useOutreachComposeFlow'

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
  const toggleComplete = useToggleTrackerTaskComplete()
  const { open: openOutreachFlow, flowNode: outreachFlowNode } =
    useOutreachComposeFlow('campaign_tracker')
  // An outreach task pending its voter-contact count in the modal.
  const [countTask, setCountTask] = useState<CampaignTrackerTask | null>(null)

  // Completing an outreach/community-event task first asks how many voters were
  // reached (legacy behavior); the count is recorded with the completion.
  // Uncompleting, and completing anything else, goes straight through.
  const onToggleComplete = (id: string, completed: boolean) => {
    if (completed) {
      const task = tasks.find((t) => t.id === id)
      if (task && isVoterContactFlowType(task.flowType)) {
        setCountTask(task)
        return
      }
    }
    toggleComplete.mutate({ id, completed })
  }

  const onCountSubmit = (count: number) => {
    if (!countTask?.flowType) return
    toggleComplete.mutate({
      id: countTask.id,
      completed: true,
      type: countTask.flowType,
      quantity: count,
    })
    setCountTask(null)
  }

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

  // Open the phase(s) the candidate is in now; fall back to the first phase.
  const openPhases = (strategy?.phases ?? [])
    .filter((phase) => phase.status === 'active')
    .map((phase) => phase.key)
  const defaultOpen =
    openPhases.length > 0
      ? openPhases
      : strategy?.phases[0]
        ? [strategy.phases[0].key]
        : []

  return (
    <section>
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Campaign Tracker</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Everything you need to do, in order. We tell you what to do and
            when, so you always know your next move.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {/* Non-prod-only manual trigger: prod generates via the weekly cron,
              but dev/qa have no cron, so this lets us dispatch a run on demand.
              gp-api 404s the route in prod as a backstop. */}
          {!IS_PROD && (
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
          )}
          <span className="text-primary mt-1 text-xs font-semibold tracking-wide uppercase">
            You are here
          </span>
        </div>
      </div>
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

      {outreachFlowNode}

      {countTask && (
        <CountModal
          open
          onOpenChange={(next) => {
            if (!next) setCountTask(null)
          }}
          flowType={countTask.flowType ?? ''}
          onSubmit={onCountSubmit}
        />
      )}
    </section>
  )
}

export default CampaignStrategySection
