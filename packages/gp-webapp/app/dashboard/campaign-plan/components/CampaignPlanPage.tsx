'use client'

import DashboardLayout from '../../shared/DashboardLayout'
import SuccessPage from 'app/onboarding/success/components/SuccessPage'
import InvalidateCampaignOnMount from 'app/onboarding/success/components/InvalidateCampaignOnMount'
import type { User } from 'helpers/types'

interface CampaignPlanPageProps {
  initialUser: User | null
}

export default function CampaignPlanPage({
  initialUser,
}: CampaignPlanPageProps): React.JSX.Element {
  return (
    <DashboardLayout>
      <InvalidateCampaignOnMount />
      <SuccessPage initialUser={initialUser} showConfetti={false} inDashboard />
    </DashboardLayout>
  )
}
