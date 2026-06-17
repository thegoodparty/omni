'use client'

import { useMemo } from 'react'
import { useCampaign } from '@shared/hooks/useCampaign'
import { Accordion } from '@styleguide'
import { useCommunityEvents } from 'app/onboarding/success/hooks/useCommunityEvents'
import { buildCampaignStrategy } from './buildCampaignStrategy'
import CampaignStrategyPhase from './CampaignStrategyPhase'

// The "Campaign strategy" section on the campaign plan page: the campaign
// tasks rendered as a four-phase, dated, prioritized list of cards using
// styleguide components. Data is assembled by buildCampaignStrategy from the
// campaign's metrics and its already-generated community events (see
// buildCampaignStrategy for the provisional notes pending the plan-to-tracker
// data contract).
const CampaignStrategySection = (): React.JSX.Element => {
  const [campaign] = useCampaign()
  const events = useCommunityEvents()

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

  const strategy = useMemo(
    () =>
      buildCampaignStrategy({
        electionDate: electionDateIso
          ? new Date(electionDateIso.replace(/-/g, '/'))
          : null,
        campaignStart: campaignStartIso ? new Date(campaignStartIso) : null,
        uniqueCellphones: metrics?.uniqueCellphones ?? null,
        uniqueLandlines: metrics?.uniqueLandlines ?? null,
        communityEvents: events.data?.events ?? [],
      }),
    [
      electionDateIso,
      campaignStartIso,
      metrics?.uniqueCellphones,
      metrics?.uniqueLandlines,
      events.data,
    ],
  )

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
            {events.isGenerating &&
              ' Finding community events in your district...'}
          </p>
        </div>
        <span className="text-primary mt-1 shrink-0 text-xs font-semibold tracking-wide uppercase">
          You are here
        </span>
      </div>
      <Accordion
        type="multiple"
        defaultValue={defaultOpen}
        className="space-y-4"
      >
        {strategy.phases.map((phase) => (
          <CampaignStrategyPhase key={phase.key} phase={phase} />
        ))}
      </Accordion>
    </section>
  )
}

export default CampaignStrategySection
