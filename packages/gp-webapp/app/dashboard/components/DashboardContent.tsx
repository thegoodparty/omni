'use client'

import DashboardLayout from '../shared/DashboardLayout'
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
  return (
    <DashboardLayout
      pathname={pathname}
      showAlert={false}
      wrapperClassName="!p-0"
    >
      <WebsiteSunsetModalController eligible={sunsetEligible} />
      <CampaignManagerHome tcrCompliance={tcrCompliance} />
    </DashboardLayout>
  )
}
