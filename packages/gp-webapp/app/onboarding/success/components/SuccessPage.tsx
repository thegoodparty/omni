'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import type { User } from 'helpers/types'
import PlanView, {
  type PlanContinueSource,
  type PlanDownloadSource,
} from './PlanView'
import { useCampaignPlanData } from '../hooks/useCampaignPlanData'
import { useGenerationTiming } from '../hooks/useGenerationTiming'

// Module-scoped dedup map so `fireOnce` survives remounts. Keyed by
// campaignId so different campaigns never share dedup state.
const _firedEvents = new Map<number, Set<string>>()

interface SuccessPageProps {
  initialUser: User | null
}

// Onboarding-only container for the campaign plan: owns the OnboardingV2
// analytics and hands presentation to PlanView. The dashboard revisit page
// has its own container (dashboard/campaign-plan/CampaignPlanView) with its
// own event namespace.
const SuccessPage = ({ initialUser }: SuccessPageProps): React.JSX.Element => {
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

  // Requested — media only. StrategicLandscapeRequested and
  // CommunityEventsRequested fire from OnboardingFlow at pre-warm time
  // (the real first request); this page only re-polls afterwards.
  useEffect(() => {
    fireOnce(EVENTS.OnboardingV2.MediaRequested, { campaignId })
  }, [campaignId])

  // Results Received — fire once when each resource's status first hits
  // ready, carrying whether a real generation happened (vs a cache fetch)
  // and how long the user waited for it. Displayed fires alongside: the
  // ready data is what PlanSections receives, so "ready" is the same
  // instant the section swaps the skeleton for content.
  useEffect(() => {
    if (!media.ready) return
    fireOnce(EVENTS.OnboardingV2.MediaResultsReceived, {
      campaignId,
      outletCount: media.outletCount,
      ...getMediaTiming(),
    })
    fireOnce(EVENTS.OnboardingV2.MediaDisplayed, { campaignId })
  }, [media.ready, media.outletCount, campaignId])

  useEffect(() => {
    if (!communityEvents.ready) return
    fireOnce(EVENTS.OnboardingV2.CommunityEventsResultsReceived, {
      campaignId,
      eventCount: communityEvents.eventCount,
      ...getEventsTiming(),
    })
    fireOnce(EVENTS.OnboardingV2.CommunityEventsDisplayed, { campaignId })
  }, [communityEvents.ready, communityEvents.eventCount, campaignId])

  useEffect(() => {
    if (!strategy.ready) return
    fireOnce(EVENTS.OnboardingV2.StrategicLandscapeResultsReceived, {
      campaignId,
      ...getStrategyTiming(),
    })
    fireOnce(EVENTS.OnboardingV2.StrategicLandscapeDisplayed, { campaignId })
  }, [strategy.ready, campaignId])

  const handleDownload = (source: PlanDownloadSource) => {
    trackEvent(EVENTS.OnboardingV2.PlanDownloaded, { campaignId, source })
  }

  const handleShared = (method: 'copy' | 'email') => {
    trackEvent(EVENTS.OnboardingV2.PlanShared, { campaignId, method })
  }

  const handleContinue = (source: PlanContinueSource) => {
    trackEvent(EVENTS.OnboardingV2.CampaignManagerClicked, {
      campaignId,
      source,
    })
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
      onShared={handleShared}
      onContinue={handleContinue}
    />
  )
}

export default SuccessPage
