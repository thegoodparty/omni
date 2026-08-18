'use client'

import Link from 'next/link'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ProBadge,
} from '@styleguide'
import { LockIcon } from '@styleguide/components/ui/icons'
import { useNativeDoorKnockingFlag } from 'app/shared/experiments/nativeDoorKnockingFlag'
import { useElectedOffice } from '@shared/hooks/useElectedOffice'
import DashboardLayout from 'app/dashboard/shared/DashboardLayout'
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

// Reached by URL or a stale tab rather than the sidebar — DashboardMenu hides
// the entry for a non-Pro org — so this is the safety net that keeps a
// flag-on, non-Pro candidate off a map whose every read 400s, not a marketing
// surface. Deliberately shorter than Know Your Opponent's locked view for that
// reason: it says what is missing and where to fix it, in the same register as
// the page's district-unavailable copy.
const DoorKnockingProLockedView = ({
  pathname,
  campaign,
}: {
  pathname: string
  campaign: Campaign | null
}): React.JSX.Element => (
  <DashboardLayout pathname={pathname} campaign={campaign}>
    <div className="mx-auto flex w-full max-w-[560px] flex-col py-10">
      <Card>
        <CardHeader className="gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="soft" className="gap-1">
              <ProBadge size="small" />
              Pro feature
            </Badge>
            <Badge variant="outline" className="gap-1">
              <LockIcon />
              Locked
            </Badge>
          </div>
          <CardTitle className="text-2xl font-semibold text-foreground">
            Door knocking is a Pro feature
          </CardTitle>
        </CardHeader>

        <CardContent className="flex flex-col gap-6">
          <p className="text-base text-muted-foreground">
            Pro lets you draw a turf on your district&apos;s voter map, build an
            optimized walking route, and log what happened at every door.
            Upgrade to turn it on for your campaign.
          </p>

          <Button asChild size="large">
            <Link href="/dashboard/pro-upgrade">Upgrade to Pro</Link>
          </Button>

          <p className="text-sm text-muted-foreground">
            Already on Pro? Reload this page and it will open.
          </p>
        </CardContent>
      </Card>
    </div>
  </DashboardLayout>
)

// The one treatment/control divergence point (same pattern as
// ContactsPageGate): flag on gets the native map experience, flag off (or
// unsettled) renders the eCanvasser dashboard exactly as before.
export default function DoorKnockingPageGate({
  pathname,
  campaign,
  summary,
}: DoorKnockingPageGateProps) {
  const { ready, enabled } = useNativeDoorKnockingFlag(true)
  const { data: electedOffice } = useElectedOffice()

  if (ready && enabled) {
    // The CRM's canUseProFeatures, which is also the predicate
    // ContactsService.assertProAccess enforces on every /v1/door-knocking
    // route: an `eo-` org is license-equivalent to Pro. Gate both the reads and
    // the writes here, because the alternative is a map that draws and then
    // fails on the first turf.
    if (!campaign?.isPro && !electedOffice) {
      return (
        <DoorKnockingProLockedView pathname={pathname} campaign={campaign} />
      )
    }
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
