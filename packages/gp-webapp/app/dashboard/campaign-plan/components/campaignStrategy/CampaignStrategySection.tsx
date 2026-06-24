'use client'

import { useMemo } from 'react'
import { useCampaign } from '@shared/hooks/useCampaign'
import { Accordion, Card } from '@styleguide'
import { buildCampaignStrategy } from './buildCampaignStrategy'
import { buildTrackerStrategy } from './buildTrackerStrategy'
import {
  useToggleTrackerTaskComplete,
  useTrackerTasks,
} from './useTrackerTasks'
import CampaignStrategyPhase from './CampaignStrategyPhase'

// The "Campaign strategy" section on the campaign plan page: the campaign
// tasks rendered as a four-phase, dated, prioritized list of cards using
// styleguide components. Data is assembled by buildCampaignStrategy from the
// campaign's metrics and its already-generated community events (see
// buildCampaignStrategy for the provisional notes pending the plan-to-tracker
// data contract).
const CampaignStrategySection = (): React.JSX.Element => {
  const [campaign] = useCampaign()
  const { tasks, isGeneratingDynamic } = useTrackerTasks()
  const toggleComplete = useToggleTrackerTaskComplete()

  // Completion only persists for real tracker rows; the catalog fallback has no
  // backing rows to toggle, so the circle stays a plain status marker there.
  const onToggleComplete =
    tasks.length > 0
      ? (id: string, completed: boolean) =>
          toggleComplete.mutate({ id, completed })
      : undefined

  const metrics = campaign?.raceTargetMetrics
  const electionDateIso =
    metrics?.relevantElectionDate ??
    metrics?.generalElectionDate ??
    campaign?.details?.electionDate ??
    campaign?.electionDate ??
    null
  // Anchor the early (asap / onboarding / launch) tasks to when the campaign
  // was created, so Pre-launch reads as "now" at the start and eventually rolls
  // to done — rather than re-pinning to today on every render.
  const campaignStartIso = campaign?.createdAt ?? null

  // Prefer the persisted tracker rows (the new campaign_tracker_tasks table)
  // once they exist; fall back to the client-side catalog for campaigns that
  // aren't on the new tracker yet.
  const strategy = useMemo(() => {
    const electionDate = electionDateIso
      ? new Date(electionDateIso.replace(/-/g, '/'))
      : null
    if (tasks.length > 0) {
      return buildTrackerStrategy(tasks, { electionDate })
    }
    return buildCampaignStrategy({
      electionDate,
      campaignStart: campaignStartIso ? new Date(campaignStartIso) : null,
      uniqueCellphones: metrics?.uniqueCellphones ?? null,
      uniqueLandlines: metrics?.uniqueLandlines ?? null,
    })
  }, [
    tasks,
    electionDateIso,
    campaignStartIso,
    metrics?.uniqueCellphones,
    metrics?.uniqueLandlines,
  ])

  // Open the phase(s) the candidate is in now; fall back to the first phase.
  const openPhases = strategy.phases
    .filter((phase) => phase.status === 'active')
    .map((phase) => phase.key)
  const defaultOpen =
    openPhases.length > 0
      ? openPhases
      : strategy.phases[0]
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
      {isGeneratingDynamic && (
        <Card className="mb-4 flex items-center gap-3 p-4">
          <div className="size-4 shrink-0 animate-spin rounded-full border-b-2 border-primary" />
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
    </section>
  )
}

export default CampaignStrategySection
