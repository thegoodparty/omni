'use client'

import DashboardLayout, {
  type DashboardNavHeaderConfig,
} from '../../shared/DashboardLayout'
import CampaignPlanView from './CampaignPlanView'
import InvalidateCampaignOnMount from 'app/onboarding/success/components/InvalidateCampaignOnMount'
import type { User } from 'helpers/types'

interface CampaignPlanPageProps {
  initialUser: User | null
  navHeader: DashboardNavHeaderConfig
}

export default function CampaignPlanPage({
  initialUser,
  navHeader,
}: CampaignPlanPageProps): React.JSX.Element {
  return (
    <DashboardLayout navHeader={navHeader}>
      <InvalidateCampaignOnMount />
      <CampaignPlanView initialUser={initialUser} />
    </DashboardLayout>
  )
}
