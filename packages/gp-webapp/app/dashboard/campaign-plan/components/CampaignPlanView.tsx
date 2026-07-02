'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { dateUsHelper } from 'helpers/dateHelper'
import type { User } from 'helpers/types'
import { useCampaign } from '@shared/hooks/useCampaign'
import { useCampaignStoryFlag } from '@shared/experiments/campaignStoryFlag'
import PlanView, {
  type PlanContinueSource,
  type PlanDownloadSource,
} from 'app/onboarding/success/components/PlanView'
import { useCampaignPlanData } from 'app/onboarding/success/hooks/useCampaignPlanData'
import { useGenerationTiming } from 'app/onboarding/success/hooks/useGenerationTiming'
import { downloadCampaignPlanPdf } from 'app/onboarding/success/pdf/downloadCampaignPlanPdf'
import CampaignStrategySection from './campaignStrategy/CampaignStrategySection'
import CampaignTrackerHero from './CampaignTrackerHero'

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
  const [campaign] = useCampaign()
  // The campaign tracker is the story cohort's experience; the story-off
  // (legacy) cohort sees the old plan content + community events and no
  // tracker. trackExposure=false: the campaign-story page is the treatment
  // surface, not this one (mirrors CampaignPlanRouter / DashboardMenu).
  const { ready: storyReady, enabled: storyEnabled } =
    useCampaignStoryFlag(false)
  // Community events are a story-off-only plan section (story-on events come
  // from the tracker). Gate the poll so the story cohort never triggers a
  // legacy community-events generation.
  const data = useCampaignPlanData(initialUser, storyReady && !storyEnabled)
  const { campaignId, strategy, media } = data
  const [heroDownloading, setHeroDownloading] = useState(false)

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
  const getMediaTiming = useGenerationTiming(media.isGenerating)

  // Requested — on the dashboard this page is the origin of these resource
  // requests (no pre-warm step like onboarding has).
  useEffect(() => {
    fireOnce(planEvents.MediaRequested, { campaignId })
    fireOnce(planEvents.StrategicLandscapeRequested, { campaignId })
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

  const handleHeroDownload = async () => {
    if (heroDownloading || !data.planReady) return
    handleDownload('download-button')
    setHeroDownloading(true)
    try {
      await downloadCampaignPlanPdf(data.plan, {
        liveUrl:
          typeof window !== 'undefined' ? window.location.href : undefined,
      })
    } finally {
      setHeroDownloading(false)
    }
  }

  const handleShared = (method: 'copy' | 'email') => {
    trackEvent(planEvents.PlanShared, { campaignId, method })
  }

  const handleContinue = (source: PlanContinueSource) => {
    trackEvent(planEvents.CampaignManagerClicked, { campaignId, source })
    router.push('/dashboard')
  }

  // Wait for the flag so we don't flash the wrong cohort's layout (story-off
  // briefly seeing the tracker, or story-on seeing the legacy hero + events).
  if (!storyReady) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="border-primary size-8 animate-spin rounded-full border-b-2" />
      </div>
    )
  }

  // Story-off (legacy): the old plan content + community events, the plan's own
  // hero, and the bottom download bar — no campaign tracker.
  if (!storyEnabled) {
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
        showConfetti={false}
        rootClassName="bg-transparent"
        contentClassName="max-w-3xl px-4"
        bottomBarClassName="fixed bottom-0 left-0 right-0 z-40 md:left-[var(--sidebar-width,16rem)]"
        navStuckClassName="sticky top-0 z-30 border-b border-base-border bg-base-surface"
      />
    )
  }

  // The hero shows the primary and general dates separately. Use the *general*
  // date for "Election Day" (not data.plan.electionDate, which is stage-anchored
  // to relevantElectionDate and would be the primary during the primary phase).
  const metrics = campaign?.raceTargetMetrics
  const primaryDateIso =
    metrics?.primaryElectionDate ?? campaign?.details?.primaryElectionDate
  // Only true general-election sources (never relevantElectionDate, which is the
  // primary during the primary phase). If none exist, show no date rather than a
  // stage-anchored one mislabeled "Election Day".
  const generalDateIso =
    metrics?.generalElectionDate ??
    campaign?.details?.electionDate ??
    campaign?.electionDate
  // dateUsHelper parses its arg with `new Date()`; a date-only ISO string is read
  // as UTC midnight and can render a day early in far-western zones (e.g. AKST).
  // Parse as local midnight (slice to the date + dash->slash) like the codebase's
  // other date-only helpers; the slice keeps it safe for full-ISO values too.
  const formatElectionDate = (iso: string): string =>
    dateUsHelper(iso.slice(0, 10).replace(/-/g, '/'))

  // Story cohort: campaign tracker on top, then the plan below it (the plan's
  // own hero + bottom download are hidden — the tracker hero owns them, and
  // community events come from the tracker, not the legacy events section).
  return (
    <>
      <div className="mx-auto w-full max-w-3xl px-4 pt-8">
        <CampaignTrackerHero
          candidateName={data.plan.candidateName}
          race={data.plan.race}
          district={campaign?.details?.district ?? ''}
          primaryDate={primaryDateIso ? formatElectionDate(primaryDateIso) : ''}
          electionDate={
            generalDateIso ? formatElectionDate(generalDateIso) : ''
          }
          onDownload={handleHeroDownload}
          downloading={heroDownloading}
          canDownload={data.planReady}
        />
        <CampaignStrategySection />
      </div>
      <PlanView
        showHero={false}
        showBottomDownload={false}
        plan={data.plan}
        planReady={data.planReady}
        state={data.state}
        strategyState={data.strategyState}
        pressOutletsState={data.pressOutletsState}
        voterInsightsContext={data.voterInsightsContext}
        onDownload={handleDownload}
        onShared={handleShared}
        onContinue={handleContinue}
        showConfetti={false}
        rootClassName="bg-transparent"
        contentClassName="max-w-3xl px-4"
        bottomBarClassName="fixed bottom-0 left-0 right-0 z-40 md:left-[var(--sidebar-width,16rem)]"
        navStuckClassName="sticky top-0 z-30 border-b border-base-border bg-base-surface"
      />
    </>
  )
}

export default CampaignPlanView
