'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { User } from 'helpers/types'
import { useCampaignStoryFlag } from '@shared/experiments/campaignStoryFlag'
import DashboardLayout from '../../shared/DashboardLayout'
import CampaignPlanPage from './CampaignPlanPage'
import CampaignPlanStoryGate from './CampaignPlanStoryGate'

interface CampaignPlanRouterProps {
  initialUser: User | null
  planExists: boolean
}

// Survives same-session navigation: a user can click generate, leave, and
// return during the brief window before the strategy row lands (which flips
// `planExists` true) and still see the generating plan rather than the gate.
const GENERATE_REQUESTED_KEY = 'campaignPlanGenerateRequested'

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
  const { ready, enabled: storyEnabled } = useCampaignStoryFlag(false)
  // Initialized false (not from sessionStorage) so the client's first render
  // matches the server's — then rehydrated from sessionStorage in an effect to
  // avoid a hydration mismatch.
  const [generateRequested, setGenerateRequested] = useState(false)

  useEffect(() => {
    if (sessionStorage.getItem(GENERATE_REQUESTED_KEY) === '1') {
      setGenerateRequested(true)
    }
  }, [])

  // Once a plan exists the request is satisfied — clear the flag so a later
  // visit doesn't skip the gate for someone who has since lost their plan.
  useEffect(() => {
    if (planExists) sessionStorage.removeItem(GENERATE_REQUESTED_KEY)
  }, [planExists])

  const requestGenerate = (): void => {
    sessionStorage.setItem(GENERATE_REQUESTED_KEY, '1')
    setGenerateRequested(true)
  }

  const redirectToDashboard = !planExists && ready && !storyEnabled
  useEffect(() => {
    if (redirectToDashboard) router.replace('/dashboard')
  }, [redirectToDashboard, router])

  // Rendering CampaignPlanView (inside CampaignPlanPage) fires the generation
  // POSTs and streams sections in as they're ready — so "generate" lands on
  // the same view as an existing plan, no blocking spinner.
  if (planExists || generateRequested) {
    return <CampaignPlanPage initialUser={initialUser} />
  }
  if (!ready || redirectToDashboard) return <Spinner />

  return (
    <DashboardLayout>
      <CampaignPlanStoryGate onGenerate={requestGenerate} />
    </DashboardLayout>
  )
}

export default CampaignPlanRouter
