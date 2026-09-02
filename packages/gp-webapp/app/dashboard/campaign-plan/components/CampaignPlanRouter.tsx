'use client'

import { useEffect, useState } from 'react'
import type { User } from 'helpers/types'
import { useCampaignStoryComplete } from 'app/dashboard/campaign-story/useCampaignStoryComplete'
import DashboardLayout, {
  type DashboardNavHeaderConfig,
} from '../../shared/DashboardLayout'
import { NAV_LABELS } from '../../shared/navLabels'
import CampaignPlanPage from './CampaignPlanPage'
import CampaignPlanStoryGate from './CampaignPlanStoryGate'

interface CampaignPlanRouterProps {
  initialUser: User | null
  // Fail closed: the existence check returns false on error, so an API blip is
  // treated as "no plan" (the same as the legacy server-redirect behavior).
  planExists: boolean
}

// Survives same-session navigation: a user can click generate, leave, and
// return during the brief window before the strategy row lands (which flips
// `planExists` true) and still see the generating plan rather than the gate.
// Stored as a timestamp and expired after the window below, so a generation
// that never produces a plan (e.g. the POST never landed) can't bypass the
// gate forever and re-fire on every return.
const GENERATE_REQUESTED_KEY = 'campaignPlanGenerateRequestedAt'
const GENERATE_REQUESTED_WINDOW_MS = 15 * 60 * 1000

const Spinner = ({
  navHeader,
}: {
  navHeader: DashboardNavHeaderConfig
}): React.JSX.Element => (
  <DashboardLayout navHeader={navHeader}>
    <div className="flex h-[60vh] items-center justify-center">
      <div className="size-8 animate-spin rounded-full border-b-2 border-primary" />
    </div>
  </DashboardLayout>
)

// Decides what the Campaign Plan tab shows. The plan/tracker shows only once
// the story is complete (it feeds both plan and tracker/event generation); an
// incomplete story is routed to the story gate rather than a tracker that can
// never populate.
const CampaignPlanRouter = ({
  initialUser,
  planExists,
}: CampaignPlanRouterProps): React.JSX.Element => {
  const { isComplete: storyComplete, isLoading: storyLoading } =
    useCampaignStoryComplete(true)
  // Initialized false (not from sessionStorage) so the client's first render
  // matches the server's — then rehydrated from sessionStorage in an effect to
  // avoid a hydration mismatch.
  const [generateRequested, setGenerateRequested] = useState(false)

  useEffect(() => {
    const raw = sessionStorage.getItem(GENERATE_REQUESTED_KEY)
    if (!raw) return
    const requestedAt = Number(raw)
    const fresh =
      Number.isFinite(requestedAt) &&
      Date.now() - requestedAt < GENERATE_REQUESTED_WINDOW_MS
    if (fresh) {
      setGenerateRequested(true)
    } else {
      sessionStorage.removeItem(GENERATE_REQUESTED_KEY)
    }
  }, [])

  // Once a plan exists the request is satisfied — clear the flag so a later
  // visit doesn't skip the gate for someone who has since lost their plan.
  useEffect(() => {
    if (planExists) sessionStorage.removeItem(GENERATE_REQUESTED_KEY)
  }, [planExists])

  // Icon + name are the sidebar tab's, so the title bar can't disagree with
  // the rail. Only the tracker hero puts a CTA in the bar (the story gate /
  // spinner have none) — the bar tracks that itself, so the same config
  // serves every branch below.
  const navHeader: DashboardNavHeaderConfig = {
    icon: 'scroll',
    label: NAV_LABELS.campaignTracker,
  }

  const requestGenerate = (): void => {
    sessionStorage.setItem(GENERATE_REQUESTED_KEY, String(Date.now()))
    setGenerateRequested(true)
  }

  // Show the plan/tracker only once the story is complete — then either an
  // existing plan or a fresh generate request lands them on it, and an
  // incomplete story falls through to the gate below.
  const showPlan = storyComplete && (planExists || generateRequested)

  // Rendering CampaignPlanView (inside CampaignPlanPage) fires the generation
  // POSTs and streams sections in as they're ready — so "generate" lands on
  // the same view as an existing plan, no blocking spinner.
  if (showPlan) {
    return <CampaignPlanPage initialUser={initialUser} navHeader={navHeader} />
  }

  // Wait until the story/website the completeness check needs have resolved
  // before choosing gate vs plan, so a complete-story user with a plan
  // doesn't briefly flash the gate before the plan renders.
  if (storyLoading) return <Spinner navHeader={navHeader} />

  return (
    <DashboardLayout navHeader={navHeader}>
      <CampaignPlanStoryGate onGenerate={requestGenerate} />
    </DashboardLayout>
  )
}

export default CampaignPlanRouter
