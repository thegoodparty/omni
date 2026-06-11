'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { DownloadIcon } from '@styleguide/components/ui/icons'
import {
  Button,
  IconButton,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@styleguide'
import ConfettiCanvas from './ConfettiCanvas'
import HeroCard from './HeroCard'
import PlanSections, {
  type EventsState,
  type PressOutletsState,
  type StrategyState,
  type VoterInsightsContext,
} from './PlanSections'
import SharePlanModal from './SharePlanModal'
import DownloadReminderModal from './DownloadReminderModal'
import type { PlanData } from './planContent'
import {
  downloadCampaignPlanPdf,
  generateCampaignPlanPdfBlob,
} from '../pdf/downloadCampaignPlanPdf'
import { uploadCampaignPlanPdf } from '../pdf/sharePlanPdf'

export type PlanDownloadSource = 'download-button' | 'reminder-modal'
export type PlanContinueSource = 'button' | 'reminder-modal'

interface PlanViewProps {
  plan: PlanData
  planReady: boolean
  state: string
  strategyState: StrategyState
  eventsState: EventsState
  pressOutletsState: PressOutletsState
  voterInsightsContext: VoterInsightsContext
  // Analytics notification — fires when a download actually starts.
  onDownload: (source: PlanDownloadSource) => void
  // The user chose to move on — caller owns tracking and navigation.
  onContinue: (source: PlanContinueSource) => void
  showConfetti?: boolean
  // Positioning only — the bar's paint (border, background) is fixed here.
  // Defaults to the standalone full-width layout; the dashboard passes a
  // variant offset by the sidebar.
  bottomBarClassName?: string
  // Forwarded to PlanSectionNav's stuck state, same caller contract.
  navStuckClassName?: string
}

// Pure presentation of the campaign plan: hero, sections, disclaimer, and
// the download/continue bar. No analytics, no data fetching — those live in
// the containers (onboarding SuccessPage, dashboard CampaignPlanView).
const PlanView = ({
  plan,
  planReady,
  state,
  strategyState,
  eventsState,
  pressOutletsState,
  voterInsightsContext,
  onDownload,
  onContinue,
  showConfetti = true,
  bottomBarClassName = 'fixed inset-x-0 bottom-0 z-40',
  navStuckClassName,
}: PlanViewProps): React.JSX.Element => {
  const [shareOpen, setShareOpen] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [hasDownloaded, setHasDownloaded] = useState(false)
  const [reminderOpen, setReminderOpen] = useState(false)

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [])

  const liveUrl = typeof window !== 'undefined' ? window.location.href : ''

  // Cache the in-flight promise so re-opening the modal while an upload is
  // still in progress reuses the same request instead of firing a second one.
  // A rejection clears the ref so the next open retries from scratch.
  const sharePdfUrlRef = useRef<Promise<string> | null>(null)
  const getShareUrl = useCallback(() => {
    if (!sharePdfUrlRef.current) {
      sharePdfUrlRef.current = (async () => {
        const blob = await generateCampaignPlanPdfBlob(plan, {
          liveUrl: liveUrl || undefined,
        })
        return uploadCampaignPlanPdf(blob)
      })().catch((e) => {
        // a failed attempt must not poison the session cache
        sharePdfUrlRef.current = null
        throw e
      })
    }
    return sharePdfUrlRef.current
  }, [plan, liveUrl])

  const handleDownload = async (source: PlanDownloadSource) => {
    if (downloading || !planReady) return
    onDownload(source)
    setDownloading(true)
    try {
      await downloadCampaignPlanPdf(plan, { liveUrl: liveUrl || undefined })
      setHasDownloaded(true)
    } finally {
      setDownloading(false)
    }
  }

  // Remind the user to grab a copy before leaving, but only if they
  // haven't already downloaded. The reminder reappears on every attempt
  // until a download succeeds.
  const handleContinue = () => {
    if (hasDownloaded) {
      onContinue('button')
      return
    }
    setReminderOpen(true)
  }

  const handleReminderDownload = async () => {
    await handleDownload('reminder-modal')
    setReminderOpen(false)
  }

  const downloadNotReadyTooltip =
    'Your plan is still being generated. It will be ready in a moment.'

  return (
    <div className="relative min-h-screen w-full bg-base-surface pb-28 text-foreground">
      {showConfetti && (
        <div className="pointer-events-none fixed inset-0 z-40">
          <ConfettiCanvas play />
        </div>
      )}

      <main className="mx-auto w-full max-w-4xl px-4 pt-4 pb-12 sm:px-8 sm:pt-16 sm:pb-20">
        <HeroCard
          candidateName={plan.candidateName}
          race={plan.race}
          state={state}
          electionDate={plan.electionDate}
          onShare={() => {
            if (!planReady) return
            setShareOpen(true)
          }}
        />

        <div className="mt-8 sm:mt-14">
          <PlanSections
            plan={plan}
            strategyState={strategyState}
            eventsState={eventsState}
            pressOutletsState={pressOutletsState}
            voterInsightsContext={voterInsightsContext}
            navStuckClassName={navStuckClassName}
          />
        </div>

        <p className="mt-12 text-sm text-muted-foreground">
          Campaign plans are AI-generated and still in beta, so double-check
          anything you&apos;ll act on against the sources. Your feedback shapes
          how we can improve our product moving forward, and we enjoy hearing
          from all our users.
        </p>
      </main>

      <div
        className={`${bottomBarClassName} border-t border-base-border bg-base-surface`}
      >
        <div className="mx-auto flex h-20 w-full max-w-4xl items-center justify-between gap-3 px-4 sm:px-8">
          {/* Mobile download. While the plan is still generating the button
              is disabled; a disabled button suppresses its own pointer
              events, so the tooltip trigger wraps it (the span gets the
              hover instead). */}
          {planReady ? (
            <IconButton
              type="button"
              variant="outline"
              size="large"
              onClick={() => handleDownload('download-button')}
              loading={downloading}
              aria-label="Download campaign plan"
              className="sm:hidden"
            >
              <DownloadIcon className="size-5" />
            </IconButton>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex sm:hidden">
                  <IconButton
                    type="button"
                    variant="outline"
                    size="large"
                    loading
                    aria-label="Preparing campaign plan"
                  >
                    <DownloadIcon className="size-5" />
                  </IconButton>
                </span>
              </TooltipTrigger>
              <TooltipContent>{downloadNotReadyTooltip}</TooltipContent>
            </Tooltip>
          )}

          {/* Desktop download. Label reads "Preparing plan…" while the plan
              is still generating, and the tooltip explains the disabled
              state on hover. */}
          {planReady ? (
            <Button
              type="button"
              variant="outline"
              size="large"
              icon={<DownloadIcon className="size-5" />}
              onClick={() => handleDownload('download-button')}
              loading={downloading}
              className="hidden sm:inline-flex"
            >
              Download
            </Button>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="hidden sm:inline-flex">
                  <Button
                    type="button"
                    variant="outline"
                    size="large"
                    icon={<DownloadIcon className="size-5" />}
                    loading
                    loadingText="Preparing plan…"
                  >
                    Download
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>{downloadNotReadyTooltip}</TooltipContent>
            </Tooltip>
          )}

          <Button
            type="button"
            variant="default"
            size="large"
            onClick={handleContinue}
          >
            Campaign manager
          </Button>
        </div>
      </div>

      <SharePlanModal
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        candidateName={plan.candidateName}
        getShareUrl={getShareUrl}
      />

      <DownloadReminderModal
        open={reminderOpen}
        onClose={() => setReminderOpen(false)}
        planReady={planReady}
        downloading={downloading}
        onDownloadNow={handleReminderDownload}
        onContinue={() => onContinue('reminder-modal')}
      />
    </div>
  )
}

export default PlanView
