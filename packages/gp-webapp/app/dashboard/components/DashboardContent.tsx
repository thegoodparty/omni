'use client'

import { useUser } from '@shared/hooks/useUser'
import { useCampaignStoryFlag } from '@shared/experiments/campaignStoryFlag'
import DashboardLayout from '../shared/DashboardLayout'
import CampaignManager from './campaignManager/CampaignManager'
import CampaignManagerHome from '../campaign-manager/CampaignManagerHome'
import { WebsiteSunsetModalController } from '../shared/WebsiteSunsetModalController'
import type { TcrCompliance } from 'helpers/types'

interface DashboardContentProps {
  pathname: string
  tcrCompliance: TcrCompliance | null
  sunsetEligible: boolean
}

export default function DashboardContent({
  pathname,
  tcrCompliance,
  sunsetEligible,
}: DashboardContentProps): React.JSX.Element {
  const [user] = useUser()
  // trackExposure=false: this read only routes the home; the campaign-story
  // page's FeatureFlagGuard is the experiment's treatment surface. Mirrors the
  // legacy CampaignManager / DashboardMenu reads. When the flag is unresolved
  // (anonymous / API blip) enabled is false, so we fall back to the legacy home.
  const { enabled: campaignStoryEnabled } = useCampaignStoryFlag(false)

  if (campaignStoryEnabled) {
    return (
      <DashboardLayout
        pathname={pathname}
        showAlert={false}
        wrapperClassName="!p-0"
      >
        <WebsiteSunsetModalController eligible={sunsetEligible} />
        <CampaignManagerHome firstName={user?.firstName || undefined} />
      </DashboardLayout>
    )
  }

  return (
    <>
      <WebsiteSunsetModalController eligible={sunsetEligible} />
      <CampaignManager pathname={pathname} tcrCompliance={tcrCompliance} />
    </>
  )
}
