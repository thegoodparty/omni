'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import type { User } from 'helpers/types'
import {
  ChevronRightIcon,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@styleguide'
import PlanView, {
  type PlanDownloadSource,
} from 'app/onboarding/success/components/PlanView'
import { useCampaignPlanData } from 'app/onboarding/success/hooks/useCampaignPlanData'
import { useGenerationTiming } from 'app/onboarding/success/hooks/useGenerationTiming'
import CampaignStrategySection from './campaignStrategy/CampaignStrategySection'
import { useTrackerTasks } from './campaignStrategy/useTrackerTasks'
import { trackerTimelineStart } from '@goodparty_org/contracts'

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
  // The plan's contact schedule starts where the tracker's timeline does.
  const { tasks } = useTrackerTasks()
  const data = useCampaignPlanData(
    initialUser,
    trackerTimelineStart(tasks)?.toISOString() ?? null,
  )
  const { campaignId, strategy, media } = data

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

  const handleShared = (method: 'copy' | 'email') => {
    trackEvent(planEvents.PlanShared, { campaignId, method })
  }

  const handleContinue = () => {
    router.push('/dashboard')
  }

  // The page opens on the campaign strategy, a card that opens the whole plan
  // in a modal, then the plan's timeline: one long card whose phase bar sticks
  // to the top as the phases scroll under it.
  return (
    <div className="w-full">
      <CampaignStrategySection
        bodyStart={
          <Dialog>
            <DialogTrigger className="bg-card hover:bg-muted/50 mb-4 flex w-full items-center gap-4 rounded-xl border px-6 py-5 text-left transition-colors">
              <span className="flex-1 text-base font-semibold">
                Campaign strategy
              </span>
              <ChevronRightIcon
                className="text-muted-foreground size-5 shrink-0"
                aria-hidden
              />
            </DialogTrigger>
            {/* Fills most of the screen: the title, close and the section
                pills stay fixed at the top while the plan scrolls under them. */}
            <DialogContent className="flex h-[calc(100dvh-2rem)] max-w-3xl flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
              <div className="flex items-center gap-3 pt-4 pr-14 pb-2 pl-6">
                <DialogTitle className="flex-1 text-lg font-semibold">
                  Campaign strategy
                </DialogTitle>
                <DialogDescription className="sr-only">
                  The whole campaign plan in one view.
                </DialogDescription>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                <PlanView
                  showHero={false}
                  showBottomDownload={false}
                  showBottomBar={false}
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
                  contentClassName="px-6 !pt-0 !pb-6"
                  bottomBarClassName="fixed bottom-0 left-0 right-0 z-40 lg:left-[var(--sidebar-width,16rem)]"
                  navVariant="pills"
                  // The pills stick to the top of the modal's scroll area,
                  // right under its title.
                  navStickyTop={0}
                  scrollToTopOnMount={false}
                />
              </div>
            </DialogContent>
          </Dialog>
        }
      />
    </div>
  )
}

export default CampaignPlanView
