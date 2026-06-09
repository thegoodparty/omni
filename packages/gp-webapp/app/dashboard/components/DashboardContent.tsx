'use client'

import { useFlagOn } from '@shared/experiments/FeatureFlagsProvider'
import DashboardPage from './DashboardPage'
import type { Task } from './tasks/TaskItem'
import type { TcrCompliance } from 'helpers/types'
import CampaignManager from './campaignManager/CampaignManager'
import { WebsiteSunsetModalController } from '../shared/WebsiteSunsetModalController'

const AI_CAMPAIGN_MANAGER_FLAG_KEY = 'ai-campaign-manager'

interface DashboardContentProps {
  pathname: string
  tasks: Task[]
  tcrCompliance: TcrCompliance | null
  sunsetEligible: boolean
}

export default function DashboardContent({
  pathname,
  tasks,
  tcrCompliance,
  sunsetEligible,
}: DashboardContentProps): React.JSX.Element {
  const { ready, on: aiCampaignManagerEnabled } = useFlagOn(
    AI_CAMPAIGN_MANAGER_FLAG_KEY,
  )

  return (
    <>
      <WebsiteSunsetModalController eligible={sunsetEligible} />
      {ready && aiCampaignManagerEnabled ? (
        <CampaignManager pathname={pathname} tcrCompliance={tcrCompliance} />
      ) : (
        <DashboardPage
          pathname={pathname}
          tasks={tasks}
          tcrCompliance={tcrCompliance}
        />
      )}
    </>
  )
}
