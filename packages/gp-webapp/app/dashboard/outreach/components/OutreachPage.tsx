'use client'
import { Suspense, useEffect, useState } from 'react'
import DashboardLayout from '../../shared/DashboardLayout'
import { OutreachHeader } from './OutreachHeader'
import FreeTextsBanner from './FreeTextsBanner'
import OutreachCreateCards from './OutreachCreateCards'
import { OutreachComposeDeepLink } from './OutreachComposeDeepLink'
import { OutreachTable } from 'app/dashboard/outreach/components/OutreachTable'
import {
  OutreachProvider,
  Outreach,
} from 'app/dashboard/outreach/hooks/OutreachContext'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { useSingleEffect } from '@shared/hooks/useSingleEffect'
import { Campaign, TcrCompliance } from 'helpers/types'

interface OutreachPageProps {
  pathname: string
  campaign: Campaign
  outreaches?: Outreach[]
  mockOutreaches?: Outreach[]
  tcrCompliance?: TcrCompliance
  preselectedListId?: number
}

export const OutreachPage = ({
  pathname,
  campaign,
  outreaches = [],
  mockOutreaches = [],
  tcrCompliance,
  preselectedListId,
}: OutreachPageProps) => {
  useSingleEffect(() => {
    trackEvent(EVENTS.Outreach.ViewAccessed)
  }, [])

  // ENG-10762 (Bugbot follow-up): OutreachComposeDeepLink strips ?listId from
  // the address bar via router.replace, which re-fetches this force-dynamic
  // route's RSC payload with the param gone — so `preselectedListId` arrives
  // as undefined on that second render. Capture the first defined value into
  // state (survives across that refresh for this mounted component instance)
  // instead of reading the prop directly downstream. A later deep link that
  // arrives with a different defined id (the page instance stays mounted)
  // still updates the capture.
  const [capturedPreselectedListId, setCapturedPreselectedListId] =
    useState(preselectedListId)
  useEffect(() => {
    if (
      preselectedListId !== undefined &&
      preselectedListId !== capturedPreselectedListId
    ) {
      setCapturedPreselectedListId(preselectedListId)
    }
  }, [preselectedListId, capturedPreselectedListId])

  return (
    <OutreachProvider initValue={outreaches}>
      <DashboardLayout pathname={pathname} campaign={campaign}>
        <OutreachHeader />
        <FreeTextsBanner tcrCompliance={tcrCompliance} />
        <OutreachCreateCards
          tcrCompliance={tcrCompliance}
          preselectedListId={capturedPreselectedListId}
        />
        <Suspense>
          <OutreachComposeDeepLink tcrCompliance={tcrCompliance} />
        </Suspense>
        <OutreachTable
          {...{
            mockOutreaches,
          }}
        />
      </DashboardLayout>
    </OutreachProvider>
  )
}
