'use client'

import DashboardLayout from '../../shared/DashboardLayout'
import CampaignPlanView from './CampaignPlanView'
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
      <CampaignPlanView initialUser={initialUser} />
    </DashboardLayout>
  )
}
