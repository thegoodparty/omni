'use client'

import DashboardLayout from '../../shared/DashboardLayout'
import SuccessPage from 'app/onboarding/success/components/SuccessPage'
import type { User } from 'helpers/types'

interface CampaignPlanPageProps {
  initialUser: User | null
}

export default function CampaignPlanPage({
  initialUser,
}: CampaignPlanPageProps): React.JSX.Element {
  return (
    <DashboardLayout>
      <SuccessPage initialUser={initialUser} showConfetti={false} />
    </DashboardLayout>
  )
}
