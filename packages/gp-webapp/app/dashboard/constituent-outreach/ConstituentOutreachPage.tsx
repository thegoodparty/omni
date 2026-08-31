'use client'

import DashboardLayout from '../shared/DashboardLayout'
import FeatureFlagGuard from '@shared/experiments/FeatureFlagGuard'
import { SERVE_OUTREACH_FLAG_KEY } from '@shared/experiments/serveOutreachFlag'
import { NAV_LABELS } from '../shared/navLabels'

interface ConstituentOutreachPageProps {
  pathname?: string
}

// Route shell only — channel cards and outreach history are follow-on
// tickets. FeatureFlagGuard is the treatment surface for this experiment; the
// nav item reads the flag with trackExposure=false.
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
        <div />
      </DashboardLayout>
    </FeatureFlagGuard>
  )
}

export default ConstituentOutreachPage
