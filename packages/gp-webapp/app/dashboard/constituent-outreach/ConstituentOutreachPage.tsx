'use client'

import { useState } from 'react'
import type { OutreachDetail } from '@goodparty_org/contracts'
import DashboardLayout from '../shared/DashboardLayout'
import FeatureFlagGuard from '@shared/experiments/FeatureFlagGuard'
import { SERVE_OUTREACH_FLAG_KEY } from '@shared/experiments/serveOutreachFlag'
import { NAV_LABELS } from '../shared/navLabels'
import ServeChannelCards from './ServeChannelCards'
import { OUTREACH_TYPES } from 'app/dashboard/outreach/constants'
import {
  OutreachProvider,
  useOutreach,
} from 'app/dashboard/outreach/hooks/OutreachContext'
import { OutreachHistoryTable } from 'app/dashboard/outreach/v2/OutreachHistoryTable'
import { OutreachDetailsDrawer } from 'app/dashboard/outreach/v2/OutreachDetailsDrawer'
import {
  SocialFlow,
  SERVE_SOCIAL_SURFACE,
} from 'app/dashboard/outreach/v2/social/SocialFlow'
import {
  fetchServeOutreachDetail,
  useSeedOutreachDetail,
} from 'app/dashboard/outreach/v2/useOutreachDetail'
import type { HistoryRow } from 'app/dashboard/outreach/v2/historyStatus.util'

interface ConstituentOutreachPageProps {
  pathname?: string
  outreaches?: HistoryRow[]
}

// Only the social card is wired (ENG-10970); other Serve channels have no
// row type yet, so a row click is scoped to social rows the same way the
// history table's onRowClick is scoped to whichever channel a caller wires.
const isSocialRow = (row: HistoryRow): boolean =>
  row.outreachType === OUTREACH_TYPES.socialMedia

const ConstituentOutreachContent = () => {
  const [outreaches, setOutreaches] = useOutreach()
  const [detailsRow, setDetailsRow] = useState<HistoryRow | null>(null)
  const [socialFlowOpen, setSocialFlowOpen] = useState(false)
  const seedOutreachDetail = useSeedOutreachDetail()

  // Mirrors OutreachHubPage's cache seeding: the save response is the
  // created row, so the drawer and the "N platforms" metric never refetch
  // it, and the row prepends to history without a list refetch.
  const handleSocialSaved = (detail: OutreachDetail) => {
    seedOutreachDetail(detail)
    setOutreaches([
      { ...detail, outreachType: 'socialMedia' },
      ...(outreaches ?? []),
    ])
  }

  return (
    <div className="mx-auto w-full max-w-7xl p-4 lg:p-6">
      <ServeChannelCards onSocialClick={() => setSocialFlowOpen(true)} />
      <SocialFlow
        open={socialFlowOpen}
        onClose={() => setSocialFlowOpen(false)}
        onSaved={handleSocialSaved}
        surface={SERVE_SOCIAL_SURFACE}
      />
      <OutreachHistoryTable
        rows={outreaches ?? []}
        onRowClick={setDetailsRow}
        rowClickable={isSocialRow}
        detailFetcher={fetchServeOutreachDetail}
      />
      <OutreachDetailsDrawer
        row={detailsRow}
        onOpenChange={(open) => {
          if (!open) setDetailsRow(null)
        }}
        detailFetcher={fetchServeOutreachDetail}
      />
    </div>
  )
}

// FeatureFlagGuard is the treatment surface for this experiment; the nav
// item reads the flag with trackExposure=false.
const ConstituentOutreachPage = ({
  pathname,
  outreaches = [],
}: ConstituentOutreachPageProps): React.JSX.Element => {
  return (
    <FeatureFlagGuard flagKey={SERVE_OUTREACH_FLAG_KEY} redirectTo="/dashboard">
      <OutreachProvider initValue={outreaches}>
        <DashboardLayout
          pathname={pathname}
          showAlert={false}
          wrapperClassName="!p-0"
          navHeader={{
            icon: 'megaphone',
            label: NAV_LABELS.constituentOutreach,
          }}
        >
          <ConstituentOutreachContent />
        </DashboardLayout>
      </OutreachProvider>
    </FeatureFlagGuard>
  )
}

export default ConstituentOutreachPage
