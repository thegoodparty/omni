'use client'

import DashboardLayout from '../../shared/DashboardLayout'
import InvalidateCampaignOnMount from 'app/onboarding/success/components/InvalidateCampaignOnMount'
import CampaignPlanView from './CampaignPlanView'
import { useCampaignPlanData } from 'app/onboarding/success/hooks/useCampaignPlanData'
import { LoaderCircleIcon } from '@styleguide'
import type { User } from 'helpers/types'

interface GeneratingPlanProps {
  initialUser: User | null
}

// Mounting this triggers generation: useCampaignPlanData fires the
// strategic-landscape / community-events POSTs and polls until ready. We show
// a loading indicator until the whole plan is ready, then hand off to the
// normal plan view.
const GeneratingPlan = ({
  initialUser,
}: GeneratingPlanProps): React.JSX.Element => {
  const { planReady } = useCampaignPlanData(initialUser)

  return (
    <DashboardLayout>
      <InvalidateCampaignOnMount />
      {planReady ? (
        <CampaignPlanView initialUser={initialUser} />
      ) : (
        <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
          <LoaderCircleIcon className="size-10 animate-spin text-primary" />
          <div className="flex flex-col gap-1">
            <h2 className="text-xl font-semibold text-foreground">
              Generating your campaign plan
            </h2>
            <p className="max-w-md text-muted-foreground">
              We&apos;re building it from your Campaign Story. This usually
              takes under a minute.
            </p>
          </div>
        </div>
      )}
    </DashboardLayout>
  )
}

export default GeneratingPlan
