'use client'

import DashboardLayout, {
  type DashboardNavHeaderConfig,
} from '../../shared/DashboardLayout'
import CampaignPlanView from './CampaignPlanView'
import LegacyCampaignPlanView from './legacy/LegacyCampaignPlanView'
import { useNextTaskExperienceFlag } from '@shared/experiments/nextTaskExperienceFlag'
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
  // The timeline plan is one arm of `next-task-experience`; off keeps the
  // plan page it replaces. Nothing renders until the flag resolves.
  const { ready, enabled } = useNextTaskExperienceFlag()
  return (
    <DashboardLayout
      navHeader={navHeader}
      {...(enabled && { wrapperClassName: '!p-0' })}
    >
      <InvalidateCampaignOnMount />
      {!ready ? null : enabled ? (
        <CampaignPlanView initialUser={initialUser} />
      ) : (
        <LegacyCampaignPlanView initialUser={initialUser} />
      )}
    </DashboardLayout>
  )
}
