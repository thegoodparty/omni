'use client'

import { useMemo } from 'react'
import { useCampaign } from '@shared/hooks/useCampaign'
import { Accordion, Card } from '@styleguide'
import { buildTrackerStrategy } from './buildTrackerStrategy'
import {
  useToggleTrackerTaskComplete,
  useTrackerTasks,
} from './useTrackerTasks'
import CampaignStrategyPhase from './CampaignStrategyPhase'

// The "Campaign strategy" section on the campaign plan page: the persisted
// campaign-tracker rows (campaign_tracker_tasks) rendered as a four-phase,
// dated, prioritized list of cards. The tracker only exists once a campaign
// has gone through campaign story, so this section is rendered only for the
// story cohort (see CampaignPlanView) — there is no client-catalog fallback.
// While the tracker is bootstrapping (no rows yet) it shows a setup state.
const CampaignStrategySection = (): React.JSX.Element => {
  const [campaign] = useCampaign()
  const { tasks, isPending, isError, isGeneratingDynamic } = useTrackerTasks()
  const toggleComplete = useToggleTrackerTaskComplete()

  const onToggleComplete = (id: string, completed: boolean) =>
    toggleComplete.mutate({ id, completed })

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
          <h2 className="text-xl font-semibold">Campaign strategy</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Everything you need to do, in order. We tell you what to do and
            when, so you always know your next move.
          </p>
        </div>
        <span className="text-primary mt-1 shrink-0 text-xs font-semibold tracking-wide uppercase">
          You are here
        </span>
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
          {isGeneratingDynamic && (
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
              />
            ))}
          </Accordion>
        </>
      )}
    </section>
  )
}

export default CampaignStrategySection
