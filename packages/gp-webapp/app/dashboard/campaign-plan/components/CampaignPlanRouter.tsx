'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { User } from 'helpers/types'
import { useCampaignStoryFlag } from '@shared/experiments/campaignStoryFlag'
import { useCampaignStrategyFlag } from '@shared/experiments/campaignStrategyFlag'
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

// Decides what the Campaign Plan tab shows. A generated plan always wins (the
// campaign-story flag is irrelevant once a plan exists). Otherwise, for
// campaign-story users we gate on story completion; everyone else keeps the
// legacy "no plan -> back to dashboard" behavior. Flag is read client-side
// (Amplitude is browser-only), matching the FeatureFlagGuard pattern.
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
  // The strategy-only cohort (campaign-strategy on, campaign-story off) used to
  // land on the onboarding success page, which is being retired in favor of
  // this page. They have no story to gate on; the plan generates on the page.
  const { ready: strategyReady, enabled: strategyEnabled } =
    useCampaignStrategyFlag()
  const ready = storyReady && strategyReady
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

  // Show the plan when it already exists, when a story-flow user has asked to
  // generate it, or for the strategy-only cohort (whose plan generates on the
  // page, as the retired success page did). The generate request only counts
  // for story users — it's set by the story gate — so a stale sessionStorage
  // flag can't let a flag-off user bypass the redirect below.
  const showPlan =
    planExists ||
    (storyEnabled && generateRequested) ||
    (strategyEnabled && !storyEnabled)

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

  return (
    <DashboardLayout>
      <CampaignPlanStoryGate onGenerate={requestGenerate} />
    </DashboardLayout>
  )
}

export default CampaignPlanRouter
