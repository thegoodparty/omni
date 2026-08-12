'use client'

import { OutreachPage } from 'app/dashboard/outreach/components/OutreachPage'
import { useVoterOutreachV2Flag } from '@shared/experiments/voterOutreachV2Flag'
import type { Outreach } from 'app/dashboard/outreach/hooks/OutreachContext'
import type { Campaign, TcrCompliance } from 'helpers/types'
import { OutreachHubPage } from './OutreachHubPage'

export interface OutreachPageGateProps {
  pathname: string
  campaign: Campaign
  outreaches?: Outreach[]
  mockOutreaches?: Outreach[]
  tcrCompliance?: TcrCompliance
  preselectedListId?: number
  highlightOutreachId?: number
}

// Whole-page outreach gate: a flag-on user gets only the v2 hub; everyone
// else (flag off or not yet settled) gets the legacy page byte-for-byte — the
// two UIs never mix. Single treatment/control divergence point, so the
// exposure fires here for both arms (the wrapper's default trackExposure).
export const OutreachPageGate = (props: OutreachPageGateProps) => {
  const { ready, enabled } = useVoterOutreachV2Flag()
  return ready && enabled ? (
    <OutreachHubPage
      pathname={props.pathname}
      campaign={props.campaign}
      outreaches={props.outreaches}
      tcrCompliance={props.tcrCompliance}
      preselectedListId={props.preselectedListId}
      initialOutreachId={props.highlightOutreachId}
    />
  ) : (
    <OutreachPage {...props} />
  )
}
