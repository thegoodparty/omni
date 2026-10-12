'use client'

import { useEffect, useRef } from 'react'
import { differenceInSeconds } from 'date-fns'
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
import { SECTION_DOM_ID } from 'app/onboarding/success/components/PlanSections'
import { useCampaignPlanData } from 'app/onboarding/success/hooks/useCampaignPlanData'
import { useGenerationTiming } from 'app/onboarding/success/hooks/useGenerationTiming'
import CampaignStrategySection from './campaignStrategy/CampaignStrategySection'
import { useTrackerTasks } from './campaignStrategy/useTrackerTasks'
import { trackerTimelineStart } from '@goodparty_org/contracts'

const planEvents = EVENTS.Dashboard.CampaignPlan

// One open of the Campaign strategy window, measured as the candidate reads.
interface StrategyRead {
  openedAt: Date
  maxScrollPercent: number
  // Index into the sections on the page, in reading order; -1 for none yet.
  deepestIndex: number
}

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

  // How far into the Campaign strategy a candidate reads: recorded while the
  // window is open, reported once when it closes (or the page goes away).
  const strategyScrollRef = useRef<HTMLDivElement>(null)
  const strategyRead = useRef<StrategyRead | null>(null)
  const presentSections = () =>
    Object.entries(SECTION_DOM_ID).flatMap(([key, id]) => {
      const element = document.getElementById(id)
      return element ? [{ key, element }] : []
    })
  const recordStrategyScroll = () => {
    const container = strategyScrollRef.current
    const read = strategyRead.current
    if (!container || !read) return
    const scrollable = container.scrollHeight - container.clientHeight
    const percent =
      scrollable <= 0
        ? 100
        : Math.round((container.scrollTop / scrollable) * 100)
    read.maxScrollPercent = Math.max(read.maxScrollPercent, percent)
    // A section counts as reached once its top is on screen.
    const bottom = container.getBoundingClientRect().bottom
    presentSections().forEach(({ element }, index) => {
      if (element.getBoundingClientRect().top < bottom) {
        read.deepestIndex = Math.max(read.deepestIndex, index)
      }
    })
  }
  const finishStrategyRead = () => {
    const read = strategyRead.current
    if (!read) return
    strategyRead.current = null
    const sections = presentSections()
    trackEvent(planEvents.CampaignStrategyClosed, {
      campaignId,
      maxScrollPercent: read.maxScrollPercent,
      deepestSection: sections[read.deepestIndex]?.key ?? 'none',
      sectionsReached: read.deepestIndex + 1,
      sectionsTotal: sections.length,
      secondsOpen: differenceInSeconds(new Date(), read.openedAt),
    })
  }
  const onStrategyOpenChange = (open: boolean) => {
    if (!open) {
      finishStrategyRead()
      return
    }
    strategyRead.current = {
      openedAt: new Date(),
      maxScrollPercent: 0,
      deepestIndex: -1,
    }
    trackEvent(planEvents.CampaignStrategyViewed, { campaignId })
    // What fits on the first screen counts as read once it has laid out.
    requestAnimationFrame(recordStrategyScroll)
  }
  // Leaving the page with the window open still reports the read. Through a
  // ref, so the listener added once always runs this render's version (with
  // the campaign id that has since loaded).
  const finishStrategyReadRef = useRef(finishStrategyRead)
  finishStrategyReadRef.current = finishStrategyRead
  useEffect(() => {
    const onPageHide = () => finishStrategyReadRef.current()
    window.addEventListener('pagehide', onPageHide)
    return () => {
      window.removeEventListener('pagehide', onPageHide)
      finishStrategyReadRef.current()
    }
  }, [])

  // The page opens on the campaign strategy, a card that opens the whole plan
  // in a modal, then the plan's timeline: one long card whose phase bar sticks
  // to the top as the phases scroll under it.
  return (
    <div className="w-full">
      <CampaignStrategySection
        bodyStart={
          <Dialog onOpenChange={onStrategyOpenChange}>
            <DialogTrigger className="bg-card hover:bg-muted/50 mb-4 flex w-full items-center gap-4 rounded-xl border px-6 py-3 text-left transition-colors">
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
              <div
                ref={strategyScrollRef}
                onScroll={recordStrategyScroll}
                className="min-h-0 flex-1 overflow-y-auto"
              >
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
