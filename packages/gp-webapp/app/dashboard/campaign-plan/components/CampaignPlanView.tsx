'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import type { User } from 'helpers/types'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Button,
  DownloadIcon,
} from '@styleguide'
import PlanView, {
  type PlanDownloadSource,
} from 'app/onboarding/success/components/PlanView'
import { useCampaignPlanData } from 'app/onboarding/success/hooks/useCampaignPlanData'
import { useGenerationTiming } from 'app/onboarding/success/hooks/useGenerationTiming'
import CampaignStrategySection from './campaignStrategy/CampaignStrategySection'
import CampaignPlanStoryCard from './CampaignPlanStoryCard'

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
      // Defer the @react-pdf/renderer chain — only loaded on an actual
      // download, keeping it out of the page bundle for everyone else.
      const { downloadCampaignPlanPdf } =
        await import('app/onboarding/success/pdf/downloadCampaignPlanPdf')
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

  const handleContinue = () => {
    router.push('/dashboard')
  }

  // The page is the tracker itself: a sticky phase progress bar, the phases up
  // to the one in focus, the full plan folded into a Summary card under them,
  // and the phases still ahead in a sticky footer. The old headline, next-step
  // band and tracker intro are gone; the PDF lives inside the Summary.
  return (
    <div className="w-full">
      <div className="mx-auto w-full max-w-3xl px-4 empty:hidden">
        <CampaignPlanStoryCard />
      </div>
      <CampaignStrategySection
        bodyEnd={
          /* The full plan folds into one card in the phases' style: closed,
             it names the plan; open, it offers the PDF and its sections are
             pills. */
          <div className="mt-4">
            <Accordion type="single" collapsible>
              <AccordionItem
                value="plan"
                className="bg-card relative rounded-xl border px-0 shadow-sm"
              >
                <AccordionTrigger className="py-5 pr-6 pl-6 hover:no-underline">
                  <span className="flex flex-1 flex-col gap-1 text-left">
                    <span className="text-base font-semibold">
                      Executive Summary
                    </span>
                    <span className="text-muted-foreground text-sm font-normal">
                      This is the whole plan in one view. If you read nothing
                      else, read this.
                    </span>
                  </span>
                </AccordionTrigger>
                {/* Under the description, outside the fold: the PDF is reachable
                    without opening the plan. A sibling of the trigger, since a button
                    can't nest in its own button. */}
                <div className="px-6 pb-5">
                  <Button
                    type="button"
                    variant="outline"
                    size="small"
                    onClick={handleHeroDownload}
                    loading={heroDownloading}
                    disabled={!data.planReady}
                    className="w-full sm:w-auto"
                  >
                    <DownloadIcon className="size-4" aria-hidden />
                    Download PDF
                  </Button>
                </div>
                <AccordionContent className="border-border border-t pt-6 data-[state=open]:overflow-visible">
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
                    // Pins just under the tracker's sticky phase bar (~73px).
                    navStickyTop={73}
                    scrollToTopOnMount={false}
                  />
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        }
      />
    </div>
  )
}

export default CampaignPlanView
