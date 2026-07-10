'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { User } from 'helpers/types'
import { useCampaignStoryFlag } from '@shared/experiments/campaignStoryFlag'
import { useCampaignStrategyFlag } from '@shared/experiments/campaignStrategyFlag'
import { useCampaignStoryComplete } from 'app/dashboard/campaign-story/useCampaignStoryComplete'
import DashboardLayout from '../../shared/DashboardLayout'
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

const Spinner = (): React.JSX.Element => (
  <DashboardLayout>
    <div className="flex h-[60vh] items-center justify-center">
      <div className="size-8 animate-spin rounded-full border-b-2 border-primary" />
    </div>
  </DashboardLayout>
)

// Decides what the Campaign Plan tab shows. For the campaign-story cohort the
// plan/tracker shows only once the story is complete (it feeds both plan and
// tracker/event generation); an incomplete story — even one that already
// generated a plan before the flag was turned on — is routed to the story gate
// rather than a tracker that can never populate. Non-story cohorts keep the
// legacy behavior: a generated plan wins, otherwise "no plan -> back to
// dashboard". Flag is read client-side (Amplitude is browser-only), matching
// the FeatureFlagGuard pattern.
const CampaignPlanRouter = ({
  initialUser,
  planExists,
}: CampaignPlanRouterProps): React.JSX.Element => {
  const router = useRouter()
  // trackExposure=false: this tab isn't the experiment's treatment surface
  // (the story page's FeatureFlagGuard is), so the read mustn't fire exposure
  // for every plan visitor — mirrors DashboardMenu.
  const { ready: storyReady, enabled: storyEnabled } =
    useCampaignStoryFlag(false)
  // The strategy-only cohort (campaign-strategy on, campaign-story off) lands
  // on the onboarding success page post-pledge, but can still open this page
  // from the menu — they have no story to gate on and see the legacy plan
  // content (no tracker; CampaignPlanView branches on the story flag).
  const { ready: strategyReady, enabled: strategyEnabled } =
    useCampaignStrategyFlag()
  const ready = storyReady && strategyReady
  // The plan/tracker is only meaningful for the story cohort once the story is
  // complete; gate on it (fetched only for that cohort via `enabled`).
  const { isComplete: storyComplete, isLoading: storyLoading } =
    useCampaignStoryComplete(storyEnabled)
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

  const requestGenerate = (): void => {
    sessionStorage.setItem(GENERATE_REQUESTED_KEY, String(Date.now()))
    setGenerateRequested(true)
  }

  // Story cohort: show the plan/tracker only once the story is complete — then
  // either an existing plan or a fresh generate request lands them on it, and an
  // incomplete story falls through to the gate below. Non-story cohorts are
  // unchanged: a generated plan wins, and the strategy-only cohort generates on
  // the page (as the retired success page did). The generate request only counts
  // for story users (it's set by the gate), so a stale sessionStorage flag can't
  // let a flag-off user bypass the redirect below.
  const showPlan = storyEnabled
    ? storyComplete && (planExists || generateRequested)
    : planExists || (strategyEnabled && !storyEnabled)

  // Only bounce when no flow applies: no plan, no story flow, no strategy flow.
  const redirectToDashboard = ready && !showPlan && !storyEnabled
  useEffect(() => {
    if (redirectToDashboard) router.replace('/dashboard')
  }, [redirectToDashboard, router])

  // Redirect wins over a persisted generate request: a user whose flag was
  // turned off must still go to /dashboard, even if sessionStorage holds a
  // stale generate flag — otherwise they'd render the plan and fire generation.
  if (redirectToDashboard) return <Spinner />

  // Rendering CampaignPlanView (inside CampaignPlanPage) fires the generation
  // POSTs and streams sections in as they're ready — so "generate" lands on
  // the same view as an existing plan, no blocking spinner.
  if (showPlan) {
    return <CampaignPlanPage initialUser={initialUser} />
  }

  if (!ready) return <Spinner />

  // Story cohort: wait until the story/website the completeness check needs have
  // resolved before choosing gate vs plan, so a complete-story user with a plan
  // doesn't briefly flash the gate before the plan renders.
  if (storyEnabled && storyLoading) return <Spinner />

  return (
    <DashboardLayout>
      <CampaignPlanStoryGate onGenerate={requestGenerate} />
    </DashboardLayout>
  )
}

export default CampaignPlanRouter
