'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import type { User } from 'helpers/types'
import PlanView, {
  type PlanContinueSource,
  type PlanDownloadSource,
} from 'app/onboarding/success/components/PlanView'
import { useCampaignPlanData } from 'app/onboarding/success/hooks/useCampaignPlanData'
import { useGenerationTiming } from 'app/onboarding/success/hooks/useGenerationTiming'

const planEvents = EVENTS.Dashboard.CampaignPlan

// Module-scoped dedup map so `fireOnce` survives remounts (users navigating
// away and back to the page). Keyed by campaignId so different campaigns
// never share dedup state. Separate from SuccessPage's map — the two
// containers track different event namespaces.
const _firedEvents = new Map<number, Set<string>>()

interface CampaignPlanViewProps {
  initialUser: User | null
}

// Dashboard revisit container for the campaign plan: same data and
// presentation as the onboarding success page, but with its own
// Dashboard.CampaignPlan analytics so the two funnels never mix.
const CampaignPlanView = ({
  initialUser,
}: CampaignPlanViewProps): React.JSX.Element => {
  const router = useRouter()
  const data = useCampaignPlanData(initialUser)
  const { campaignId, strategy, communityEvents, media } = data

  // Per-resource lifecycle events fire exactly once per campaign visit. The
  // hooks poll on an interval, so an effect that runs on every status change
  // would re-fire without a guard. No-op until the campaign resolves: every
  // calling effect lists campaignId in its deps and re-runs when it lands,
  // so firing early would record under a placeholder key and then re-fire
  // under the real one.
  const fireOnce = (
    event: string,
    properties: Record<string, string | number | boolean | undefined>,
  ): void => {
    if (campaignId === undefined) return
    let fired = _firedEvents.get(campaignId)
    if (!fired) {
      fired = new Set()
      _firedEvents.set(campaignId, fired)
    }
    if (fired.has(event)) return
    fired.add(event)
    trackEvent(event, properties)
  }

  const getStrategyTiming = useGenerationTiming(strategy.isGenerating)
  const getEventsTiming = useGenerationTiming(communityEvents.isGenerating)
  const getMediaTiming = useGenerationTiming(media.isGenerating)

  // Requested — on the dashboard this page is the origin of all three
  // resource requests (no pre-warm step like onboarding has).
  useEffect(() => {
    fireOnce(planEvents.MediaRequested, { campaignId })
    fireOnce(planEvents.StrategicLandscapeRequested, { campaignId })
    fireOnce(planEvents.CommunityEventsRequested, { campaignId })
  }, [campaignId])

  // Results Received — fire once when each resource's status first hits
  // ready, carrying whether a real generation happened (vs a cache fetch)
  // and how long the user waited for it. Displayed fires alongside: the
  // ready data is what PlanSections receives, so "ready" is the same
  // instant the section swaps the skeleton for content.
  useEffect(() => {
    if (!media.ready) return
    fireOnce(planEvents.MediaResultsReceived, {
      campaignId,
      outletCount: media.outletCount,
      ...getMediaTiming(),
    })
    fireOnce(planEvents.MediaDisplayed, { campaignId })
  }, [media.ready, media.outletCount, campaignId])

  useEffect(() => {
    if (!communityEvents.ready) return
    fireOnce(planEvents.CommunityEventsResultsReceived, {
      campaignId,
      eventCount: communityEvents.eventCount,
      ...getEventsTiming(),
    })
    fireOnce(planEvents.CommunityEventsDisplayed, { campaignId })
  }, [communityEvents.ready, communityEvents.eventCount, campaignId])

  useEffect(() => {
    if (!strategy.ready) return
    fireOnce(planEvents.StrategicLandscapeResultsReceived, {
      campaignId,
      ...getStrategyTiming(),
    })
    fireOnce(planEvents.StrategicLandscapeDisplayed, { campaignId })
  }, [strategy.ready, campaignId])

  const handleDownload = (source: PlanDownloadSource) => {
    trackEvent(planEvents.PlanDownloaded, { campaignId, source })
  }

  const handleContinue = (source: PlanContinueSource) => {
    trackEvent(planEvents.CampaignManagerClicked, { campaignId, source })
    router.push('/dashboard')
  }

  return (
    <PlanView
      plan={data.plan}
      planReady={data.planReady}
      state={data.state}
      strategyState={data.strategyState}
      eventsState={data.eventsState}
      pressOutletsState={data.pressOutletsState}
      voterInsightsContext={data.voterInsightsContext}
      onDownload={handleDownload}
      onContinue={handleContinue}
      showConfetti={false}
      bottomBarClassName="fixed bottom-0 left-0 right-0 z-40 md:left-[var(--sidebar-width,16rem)]"
      navStuckClassName="sticky top-0 z-30 border-b border-base-border bg-base-surface"
    />
  )
}

export default CampaignPlanView
