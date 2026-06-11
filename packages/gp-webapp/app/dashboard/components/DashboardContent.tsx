'use client'

import CampaignManager from './campaignManager/CampaignManager'
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
    <>
      <WebsiteSunsetModalController eligible={sunsetEligible} />
      <CampaignManager pathname={pathname} tcrCompliance={tcrCompliance} />
    </>
  )
}
