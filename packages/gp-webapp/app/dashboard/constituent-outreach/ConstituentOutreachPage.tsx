'use client'

import DashboardLayout from '../shared/DashboardLayout'
import FeatureFlagGuard from '@shared/experiments/FeatureFlagGuard'
import { SERVE_OUTREACH_FLAG_KEY } from '@shared/experiments/serveOutreachFlag'
import { NAV_LABELS } from '../shared/navLabels'
import ServeChannelCards from './ServeChannelCards'

interface ConstituentOutreachPageProps {
  pathname?: string
}

// FeatureFlagGuard is the treatment surface for this experiment; the nav
// item reads the flag with trackExposure=false. Outreach history is a
// follow-on ticket.
const ConstituentOutreachPage = ({
  pathname,
}: ConstituentOutreachPageProps): React.JSX.Element => {
  return (
    <FeatureFlagGuard flagKey={SERVE_OUTREACH_FLAG_KEY} redirectTo="/dashboard">
      <DashboardLayout
        pathname={pathname}
        showAlert={false}
        wrapperClassName="!p-0"
        navHeader={{
          icon: 'megaphone',
          label: NAV_LABELS.constituentOutreach,
        }}
      >
        <div className="mx-auto w-full max-w-7xl p-4 lg:p-6">
          <ServeChannelCards />
        </div>
      </DashboardLayout>
    </FeatureFlagGuard>
  )
}

export default ConstituentOutreachPage
