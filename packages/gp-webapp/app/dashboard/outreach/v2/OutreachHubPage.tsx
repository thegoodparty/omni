'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import DashboardLayout from 'app/dashboard/shared/DashboardLayout'
import {
  OutreachProvider,
  useOutreach,
  type Outreach,
} from 'app/dashboard/outreach/hooks/OutreachContext'
import { OutreachComposeDeepLink } from 'app/dashboard/outreach/components/OutreachComposeDeepLink'
import { noop } from '@shared/utils/noop'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { useSingleEffect } from '@shared/hooks/useSingleEffect'
import type { Campaign, TcrCompliance } from 'helpers/types'
import { ChannelTileGrid } from './ChannelTileGrid'
import { OutreachHistoryTable } from './OutreachHistoryTable'
import { OutreachDetailsDrawer } from './OutreachDetailsDrawer'
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
  const [outreaches] = useOutreach()
  const [detailsRow, setDetailsRow] = useState<HistoryRow | null>(null)

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
    <div className="p-4 lg:p-6">
      <ChannelTileGrid
        tcrCompliance={tcrCompliance}
        preselectedListId={preselectedListId}
        onCreateSocial={noop}
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
      <DashboardLayout pathname={pathname} campaign={campaign}>
        <OutreachHubContent
          {...{ tcrCompliance, preselectedListId, initialOutreachId }}
        />
      </DashboardLayout>
    </OutreachProvider>
  )
}
