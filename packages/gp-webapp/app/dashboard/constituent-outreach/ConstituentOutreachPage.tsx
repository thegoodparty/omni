'use client'

import DashboardLayout from '../shared/DashboardLayout'
import FeatureFlagGuard from '@shared/experiments/FeatureFlagGuard'
import { SERVE_OUTREACH_FLAG_KEY } from '@shared/experiments/serveOutreachFlag'
import { NAV_LABELS } from '../shared/navLabels'
import ServeChannelCards from './ServeChannelCards'
import { OutreachHistoryTable } from 'app/dashboard/outreach/v2/OutreachHistoryTable'
import type { HistoryRow } from 'app/dashboard/outreach/v2/historyStatus.util'

interface ConstituentOutreachPageProps {
  pathname?: string
  outreaches?: HistoryRow[]
}

// FeatureFlagGuard is the treatment surface for this experiment; the nav
// item reads the flag with trackExposure=false.
const ConstituentOutreachPage = ({
  pathname,
  outreaches = [],
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
          <OutreachHistoryTable
            rows={outreaches}
            // Row-click drawer is deferred: OutreachDetailsDrawer pulls in
            // candidate-only dependencies (TCR compliance banner, checkout
            // receipts via OUTREACH_OPTIONS/OutreachContext) that don't
            // apply to a Serve org with no campaign.
            onRowClick={() => undefined}
          />
        </div>
      </DashboardLayout>
    </FeatureFlagGuard>
  )
}

export default ConstituentOutreachPage
