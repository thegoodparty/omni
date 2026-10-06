'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { dateUsHelper } from 'helpers/dateHelper'
import type { User } from 'helpers/types'
import { useCampaign } from '@shared/hooks/useCampaign'
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
import NextTaskCard from './campaignStrategy/NextTaskCard'
import ProgressSection from '../../components/campaignManager/ProgressSection'
import { VoterContactsProvider } from '@shared/hooks/VoterContactsProvider'
import { CampaignUpdateHistoryProvider } from '@shared/hooks/CampaignUpdateHistoryProvider'
import CampaignTrackerHero from './CampaignTrackerHero'
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
  const [campaign] = useCampaign()
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

  // Next step on top, then the headline and tracker, then the plan below it
  // (the plan's own hero + bottom download are hidden — the tracker hero owns
  // them).
  return (
    <>
      {/* The next step leads the page, ruled off across the full content
          width from the candidate's headline and the tracker below it, and
          stays pinned while the tracker scrolls under it. */}
      <div className="sticky top-0 z-20 w-full border-b border-border bg-background">
        <div className="mx-auto w-full max-w-3xl px-4 pt-4 pb-6 has-[[data-slot=collapsible][data-state=closed]]:pb-4">
          <NextTaskCard surface="plan" heading="Here’s what to do next" />
        </div>
      </div>
      <div className="mx-auto w-full max-w-3xl px-4 pt-10">
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
        <div className="mb-5">
          <h2 className="text-xl font-semibold">Campaign Tracker</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Everything you need to do, in order. We tell you what to do and
            when, so you always know your next move.
          </p>
        </div>
        <div className="mb-6">
          <VoterContactsProvider>
            <CampaignUpdateHistoryProvider>
              <ProgressSection />
            </CampaignUpdateHistoryProvider>
          </VoterContactsProvider>
        </div>
        <CampaignPlanStoryCard />
        <CampaignStrategySection />
      </div>
      {/* The full plan folds into one card in the phases' style: closed, it
          names the plan and offers the PDF; open, its sections are pills. */}
      <div className="mx-auto mt-4 w-full max-w-3xl px-4 pb-10">
        <Accordion type="single" collapsible>
          <AccordionItem
            value="plan"
            className="bg-card relative overflow-hidden rounded-xl border px-0 shadow-sm"
          >
            <AccordionTrigger className="py-5 pr-6 pl-6 hover:no-underline">
              <span className="flex flex-1 flex-col gap-1 text-left">
                <span className="text-base font-semibold">
                  Executive Summary
                </span>
                <span className="text-muted-foreground text-sm font-normal">
                  This is the whole plan in one view. If you read nothing else,
                  read this.
                </span>
              </span>
            </AccordionTrigger>
            {/* A sibling of the trigger, not inside it: a button can't nest
                in the trigger's own button. Sits just left of its chevron. */}
            {/* Below the description, left-aligned with it: a sibling of
                the trigger, since a button can't nest in its own button. */}
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
            <AccordionContent className="border-border border-t pt-6">
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
                scrollToTopOnMount={false}
              />
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
    </>
  )
}

export default CampaignPlanView
