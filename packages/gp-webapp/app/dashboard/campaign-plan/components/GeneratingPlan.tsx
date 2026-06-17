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
// strategic-landscape / community-events POSTs and polls until ready. We render
// the plan immediately so its sections stream in (skeleton -> content) rather
// than blocking the whole page behind a spinner; a banner reassures the user
// while any section is still generating.
const GeneratingPlan = ({
  initialUser,
}: GeneratingPlanProps): React.JSX.Element => {
  const { planReady } = useCampaignPlanData(initialUser)

  return (
    <DashboardLayout>
      <InvalidateCampaignOnMount />
      {!planReady && (
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-border bg-primary/5 p-4">
          <LoaderCircleIcon className="size-5 shrink-0 animate-spin text-primary" />
          <div className="flex flex-col">
            <span className="font-semibold text-foreground">
              Generating your campaign plan
            </span>
            <span className="text-sm text-muted-foreground">
              We&apos;re building it from your Campaign Story. This usually
              takes less than 3 minutes.
            </span>
          </div>
        </div>
      )}
      <CampaignPlanView initialUser={initialUser} />
    </DashboardLayout>
  )
}

export default GeneratingPlan
