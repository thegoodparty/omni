'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { User } from 'helpers/types'
import { useCampaignStoryFlag } from '@shared/experiments/campaignStoryFlag'
import DashboardLayout from '../../shared/DashboardLayout'
import CampaignPlanPage from './CampaignPlanPage'
import CampaignPlanStoryGate from './CampaignPlanStoryGate'
import GeneratingPlan from './GeneratingPlan'

interface CampaignPlanRouterProps {
  initialUser: User | null
  planExists: boolean
}

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
  const { ready, enabled: storyEnabled } = useCampaignStoryFlag()
  const [generateRequested, setGenerateRequested] = useState(false)

  const redirectToDashboard = !planExists && ready && !storyEnabled
  useEffect(() => {
    if (redirectToDashboard) router.replace('/dashboard')
  }, [redirectToDashboard, router])

  if (planExists) return <CampaignPlanPage initialUser={initialUser} />
  if (generateRequested) return <GeneratingPlan initialUser={initialUser} />
  if (!ready || redirectToDashboard) return <Spinner />

  return (
    <DashboardLayout>
      <CampaignPlanStoryGate onGenerate={() => setGenerateRequested(true)} />
    </DashboardLayout>
  )
}

export default CampaignPlanRouter
