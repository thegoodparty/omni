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
  PhoneBankingFlow,
  SERVE_PHONE_BANKING_SURFACE,
} from 'app/dashboard/outreach/v2/phone-banking/PhoneBankingFlow'
import {
  fetchServeOutreachDetail,
  useSeedOutreachDetail,
} from 'app/dashboard/outreach/v2/useOutreachDetail'
import type { HistoryRow } from 'app/dashboard/outreach/v2/historyStatus.util'

interface ConstituentOutreachPageProps {
  pathname?: string
  outreaches?: HistoryRow[]
}

// Social and phone banking are the wired cards (ENG-10970); door knocking has
// no row type yet, so a row click is scoped to the two wired channels the
// same way the history table's onRowClick is scoped to whichever channels a
// caller wires.
const isDrawerRow = (row: HistoryRow): boolean =>
  row.outreachType === OUTREACH_TYPES.socialMedia ||
  row.outreachType === OUTREACH_TYPES.nativePhoneBanking

const ConstituentOutreachContent = () => {
  const [outreaches, setOutreaches] = useOutreach()
  const [detailsRow, setDetailsRow] = useState<HistoryRow | null>(null)
  const [socialFlowOpen, setSocialFlowOpen] = useState(false)
  const [phoneBankingFlowOpen, setPhoneBankingFlowOpen] = useState(false)
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

  // Mirrors OutreachHubPage's handlePhoneBankingSaved: the create response is
  // the list, not a full OutreachDetail (unlike social's save), so there is
  // no detail to seed — just enough to prepend a row so the history table
  // doesn't stay stale until the next full load. Status is in_progress (not
  // completed) to match what phoneBankingList.service.ts actually creates —
  // historyStatus.util.ts maps that to "In progress" for the native channels.
  const handlePhoneBankingSaved = (outreachId: number, name: string) => {
    setOutreaches([
      {
        id: outreachId,
        name,
        outreachType: 'nativePhoneBanking',
        status: 'in_progress',
        // OutreachHistoryTable sorts newest-first off date ?? createdAt
        // (rowTime falls back to 0 with neither); the create response
        // carries no timestamp, so without this the row sorts to the
        // bottom despite being prepended.
        createdAt: new Date().toISOString(),
      },
      ...(outreaches ?? []),
    ])
  }

  return (
    <div className="mx-auto w-full max-w-7xl p-4 lg:p-6">
      <ServeChannelCards
        onSocialClick={() => setSocialFlowOpen(true)}
        onPhoneBankingClick={() => setPhoneBankingFlowOpen(true)}
      />
      <SocialFlow
        open={socialFlowOpen}
        onClose={() => setSocialFlowOpen(false)}
        onSaved={handleSocialSaved}
        surface={SERVE_SOCIAL_SURFACE}
      />
      <PhoneBankingFlow
        open={phoneBankingFlowOpen}
        onClose={() => setPhoneBankingFlowOpen(false)}
        onSaved={handlePhoneBankingSaved}
        surface={SERVE_PHONE_BANKING_SURFACE}
      />
      <OutreachHistoryTable
        rows={outreaches ?? []}
        onRowClick={setDetailsRow}
        rowClickable={isDrawerRow}
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
