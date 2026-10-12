'use client'

import DashboardLayout from '../shared/DashboardLayout'
import { NAV_LABELS } from '../shared/navLabels'
import CampaignManagerHome from '../campaign-manager/CampaignManagerHome'
import LegacyCampaignManagerHome from '../campaign-manager/legacy/LegacyCampaignManagerHome'
import { useNextTaskExperienceFlag } from '@shared/experiments/nextTaskExperienceFlag'
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
  // Home is one arm of `next-task-experience`; off keeps the Campaign
  // Manager home it replaces. Nothing renders until the flag resolves, so
  // neither arm flashes before the other.
  const { ready, enabled } = useNextTaskExperienceFlag()
  return (
    <DashboardLayout
      pathname={pathname}
      showAlert={false}
      wrapperClassName="!p-0"
      navHeader={
        enabled
          ? { icon: 'house', label: NAV_LABELS.home }
          : { icon: 'dashboard', label: NAV_LABELS.campaignManager }
      }
    >
      <WebsiteSunsetModalController eligible={sunsetEligible} />
      {!ready ? null : enabled ? (
        <CampaignManagerHome tcrCompliance={tcrCompliance} />
      ) : (
        <LegacyCampaignManagerHome tcrCompliance={tcrCompliance} />
      )}
    </DashboardLayout>
  )
}
