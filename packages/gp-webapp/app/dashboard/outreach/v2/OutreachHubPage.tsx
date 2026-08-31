'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import DashboardLayout from 'app/dashboard/shared/DashboardLayout'
import { NAV_LABELS } from 'app/dashboard/shared/navLabels'
import {
  OutreachProvider,
  useOutreach,
  type Outreach,
} from 'app/dashboard/outreach/hooks/OutreachContext'
import { OutreachComposeDeepLink } from 'app/dashboard/outreach/components/OutreachComposeDeepLink'
import { clientRequest } from 'gpApi/typed-request'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { useSingleEffect } from '@shared/hooks/useSingleEffect'
import type { Campaign, TcrCompliance } from 'helpers/types'
import type { OutreachDetail } from '@goodparty_org/contracts'
import { ChannelTileGrid } from './ChannelTileGrid'
import { OutreachHistoryTable } from './OutreachHistoryTable'
import { OutreachDetailsDrawer } from './OutreachDetailsDrawer'
import { SocialFlow } from './social/SocialFlow'
import { RobocallFlow } from './robocall/RobocallFlow'
import { PhoneBankingFlow } from './phone-banking/PhoneBankingFlow'
import { SmsFlow } from './sms/SmsFlow'
import { useSeedOutreachDetail } from './useOutreachDetail'
import type { HistoryRow } from './historyStatus.util'

export interface OutreachHubPageProps {
  pathname: string
  campaign: Campaign
  outreaches?: Outreach[]
  tcrCompliance?: TcrCompliance
  preselectedListId?: number
  // ?outreachId= deep link (activity feed "View outreach"): in the v2 hub it
  // opens the details drawer instead of highlighting a table row.
  initialOutreachId?: number
}

const OutreachHubContent = ({
  tcrCompliance,
  preselectedListId,
  initialOutreachId,
}: Pick<
  OutreachHubPageProps,
  'tcrCompliance' | 'preselectedListId' | 'initialOutreachId'
>) => {
  const router = useRouter()
  const [outreaches, setOutreaches] = useOutreach()
  const [detailsRow, setDetailsRow] = useState<HistoryRow | null>(null)
  const [socialFlowOpen, setSocialFlowOpen] = useState(false)
  const [robocallFlowOpen, setRobocallFlowOpen] = useState(false)
  const [phoneBankingFlowOpen, setPhoneBankingFlowOpen] = useState(false)
  const [smsFlowOpen, setSmsFlowOpen] = useState(false)
  const seedOutreachDetail = useSeedOutreachDetail()

  // The save response is the created row: seed the detail cache (so the
  // drawer and the "N platforms" metric never refetch it) and prepend it to
  // the history without a list refetch.
  const handleSocialSaved = (detail: OutreachDetail) => {
    seedOutreachDetail(detail)
    setOutreaches([
      { ...detail, outreachType: 'socialMedia' },
      ...(outreaches ?? []),
    ])
  }

  // The phone-banking create response is the list, not a full OutreachDetail
  // (unlike social's save) — no detail to seed, just enough to prepend a row
  // so the history table doesn't stay stale until the next full load.
  // Status is in_progress (not completed) to match what
  // phoneBankingList.service.ts actually creates — historyStatus.util.ts
  // maps that to "In progress" for the native channels.
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

  // Payment finalizes server-side (Peerly job, status flip), so the new row
  // only exists after a refetch — same as the legacy purchase completion.
  const handleSmsScheduled = async () => {
    const { data } = await clientRequest('GET /v1/outreach', {})
    setOutreaches(data ?? [])
  }

  // Consume-once (ENG-10769 conventions): strip the param, open the drawer
  // if the id resolves; the ref keeps an already-consumed id from reopening
  // while still accepting a new deep link arriving while mounted.
  const consumedOutreachIdRef = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (
      initialOutreachId === undefined ||
      initialOutreachId === consumedOutreachIdRef.current
    ) {
      return
    }
    consumedOutreachIdRef.current = initialOutreachId
    router.replace('/dashboard/outreach', { scroll: false })
    const row = outreaches?.find((o) => o.id === initialOutreachId)
    if (row) {
      setDetailsRow(row)
    }
  }, [initialOutreachId, outreaches, router])

  return (
    <div className="mx-auto w-full max-w-7xl p-4 lg:p-6">
      <ChannelTileGrid
        tcrCompliance={tcrCompliance}
        preselectedListId={preselectedListId}
        onCreateSocial={() => setSocialFlowOpen(true)}
        onCreateSms={() => setSmsFlowOpen(true)}
        onCreateRobocall={() => setRobocallFlowOpen(true)}
        onCreatePhoneBanking={() => setPhoneBankingFlowOpen(true)}
      />
      <SocialFlow
        open={socialFlowOpen}
        onClose={() => setSocialFlowOpen(false)}
        onSaved={handleSocialSaved}
      />
      <RobocallFlow
        open={robocallFlowOpen}
        onClose={() => setRobocallFlowOpen(false)}
      />
      <PhoneBankingFlow
        open={phoneBankingFlowOpen}
        onClose={() => setPhoneBankingFlowOpen(false)}
        onSaved={handlePhoneBankingSaved}
      />
      <SmsFlow
        open={smsFlowOpen}
        onClose={() => setSmsFlowOpen(false)}
        onScheduled={handleSmsScheduled}
      />
      <Suspense>
        <OutreachComposeDeepLink tcrCompliance={tcrCompliance} />
      </Suspense>
      <OutreachHistoryTable
        rows={outreaches ?? []}
        onRowClick={setDetailsRow}
      />
      <OutreachDetailsDrawer
        row={detailsRow}
        onOpenChange={(open) => {
          if (!open) setDetailsRow(null)
        }}
      />
    </div>
  )
}

export const OutreachHubPage = ({
  pathname,
  campaign,
  outreaches = [],
  tcrCompliance,
  preselectedListId,
  initialOutreachId,
}: OutreachHubPageProps) => {
  useSingleEffect(() => {
    trackEvent(EVENTS.Outreach.ViewAccessed, { surface: 'v2' })
  }, [])

  return (
    <OutreachProvider initValue={outreaches}>
      <DashboardLayout
        pathname={pathname}
        campaign={campaign}
        navHeader={{ label: NAV_LABELS.voterOutreach }}
      >
        <OutreachHubContent
          {...{ tcrCompliance, preselectedListId, initialOutreachId }}
        />
      </DashboardLayout>
    </OutreachProvider>
  )
}
