'use client'

import { useNativeDoorKnockingFlag } from 'app/shared/experiments/nativeDoorKnockingFlag'
import DoorKnockingPage from '../components/DoorKnockingPage'
import NativeDoorKnockingPage from './NativeDoorKnockingPage'
import { Campaign } from 'helpers/types'

interface EcanvasserSummary {
  totalInteractions?: number
  totalContactAttempts?: number
  totalHouseholds?: number
  lastSync?: string
}

interface DoorKnockingPageGateProps {
  pathname: string
  campaign: Campaign | null
  summary?: EcanvasserSummary
}

// The one treatment/control divergence point (same pattern as
// ContactsPageGate): flag on gets the native map experience, flag off (or
// unsettled) renders the eCanvasser dashboard exactly as before.
export default function DoorKnockingPageGate({
  pathname,
  campaign,
  summary,
}: DoorKnockingPageGateProps) {
  const { ready, enabled } = useNativeDoorKnockingFlag(true)

  if (ready && enabled) {
    return <NativeDoorKnockingPage pathname={pathname} campaign={campaign} />
  }
  return (
    <DoorKnockingPage
      pathname={pathname}
      campaign={campaign}
      summary={summary}
    />
  )
}
