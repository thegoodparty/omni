'use client'
import type { RecommendedListVariant } from '@goodparty_org/contracts'

import { useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
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
import { useOrganization } from '@shared/organization-picker'
import { LoadingAnimation } from 'app/shared/utils/LoadingAnimation'
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
  // Whether candidate success has connected this campaign to eCanvasser. The
  // flag-off arm's entitlement, resolved server-side in `page.tsx`.
  hasEcanvasser?: boolean
  // `?listId=` / `?recommended=` off the page. Only the native arm has a
  // create flow to open on them; the eCanvasser dashboard has no audience
  // step to preselect.
  preselectedListId?: number
  preselectedRecommendedVariant?: RecommendedListVariant
  // `?walkTurfId=` and `?outreachId=` — the outreach hub's "Continue
  // knocking". Native-only for the same reason: eCanvasser has no walk.
  walkTurfId?: number
  fromOutreachId?: number
  // `?create=1` — the hub's tile opening the create flow on arrival. Native
  // only, for the same reason as the two above.
  openCreateFlow?: boolean
  // `?campaignOutreachId=` — the drawer's "Add another turf" opening the
  // flow onto an existing campaign. Native only.
  campaignOutreachId?: number
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

// Door knocking off the flag, for a campaign candidate success has not
// connected. The eCanvasser dashboard behind this is a view onto a
// third-party canvassing tool, so without that connection every panel on it
// reads zero and a blank "Last updated" — a screen that looks broken rather
// than one that says the feature is not on yet. Reached only by the outreach
// hub's tile, which is deliberately still offered: this card names who can
// turn it on, where hiding the tile would leave no way to ask.
const DoorKnockingUnavailableView = ({
  pathname,
  campaign,
}: {
  pathname: string
  campaign: Campaign | null
}): React.JSX.Element => (
  <DashboardLayout pathname={pathname} campaign={campaign}>
    <div className="mx-auto flex w-full max-w-[560px] flex-col py-10">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl font-semibold text-foreground">
            Door knocking isn&apos;t turned on for your campaign
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-base text-muted-foreground">
            Email support@goodparty.org and we&apos;ll get you set up.
          </p>
        </CardContent>
      </Card>
    </div>
  </DashboardLayout>
)

// The one treatment/control divergence point: flag on gets the native map
// experience, flag off (or unsettled) renders the eCanvasser dashboard
// exactly as before — for a candidate. A Serve org has no control arm to fall
// back to: the eCanvasser dashboard reports a third-party canvassing
// integration that only a campaign can connect, and door knocking reached the
// Serve rail already native, so this route simply does not exist for a
// flag-off elected official. Bounced to the hub it came from rather than
// rendered, because there is nothing here to show them and a Win-only legacy
// screen reads as a broken page rather than an absent feature.
//
// Read off the org slug rather than `useElectedOffice`, which is the predicate
// the Pro gate below uses: that query is async, and waiting on it would put a
// spinner in front of every control-arm CANDIDATE on a page that otherwise
// renders straight away. The slug is already resolved, and `eo-` is the same
// prefix `NativeDoorKnockingPage` reads for its Serve vocabulary.
export default function DoorKnockingPageGate({
  pathname,
  campaign,
  summary,
  hasEcanvasser,
  preselectedListId,
  preselectedRecommendedVariant,
  walkTurfId,
  fromOutreachId,
  openCreateFlow,
  campaignOutreachId,
}: DoorKnockingPageGateProps) {
  const { ready, enabled } = useNativeDoorKnockingFlag(true)
  const { data: electedOffice, isPending: isElectedOfficePending } =
    useElectedOffice()
  const router = useRouter()
  const isServeOrg = Boolean(useOrganization()?.slug?.startsWith('eo-'))
  const serveWithoutFlag = ready && !enabled && isServeOrg

  useEffect(() => {
    if (serveWithoutFlag) router.replace('/dashboard/constituent-outreach')
  }, [serveWithoutFlag, router])

  if (serveWithoutFlag) return null

  if (ready && enabled) {
    // The CRM's canUseProFeatures, which is also the predicate
    // ContactsService.assertProAccess enforces on every /v1/door-knocking
    // route: an `eo-` org is license-equivalent to Pro. Gate both the reads and
    // the writes here, because the alternative is a map that draws and then
    // fails on the first turf.
    //
    // Only a non-Pro campaign has to consult the elected-office query, so a Pro
    // candidate never waits on it. And an unsettled query is not a refusal: a
    // Serve org's access comes from exactly that query and its campaign is
    // never `isPro`, so treating undefined as "not elected office" would flash
    // the upgrade card at the org most entitled to the feature, on every cold
    // load. DashboardMenu holds its own elected-office decisions the same way.
    if (!campaign?.isPro) {
      if (isElectedOfficePending) {
        return (
          <DashboardLayout pathname={pathname} campaign={campaign}>
            <div className="flex w-full items-center justify-center py-20">
              <LoadingAnimation />
            </div>
          </DashboardLayout>
        )
      }
      if (!electedOffice) {
        return (
          <DoorKnockingProLockedView pathname={pathname} campaign={campaign} />
        )
      }
    }
    return (
      <NativeDoorKnockingPage
        pathname={pathname}
        campaign={campaign}
        preselectedListId={preselectedListId}
        preselectedRecommendedVariant={preselectedRecommendedVariant}
        walkTurfId={walkTurfId}
        fromOutreachId={fromOutreachId}
        openCreateFlow={openCreateFlow}
        campaignOutreachId={campaignOutreachId}
      />
    )
  }
  // Control, and it has an entitlement of its own that nothing used to check:
  // the eCanvasser connection. Unsettled reads as connected, so a slow or
  // failed server read shows the dashboard it always did rather than telling
  // a connected campaign their feature is off.
  if (hasEcanvasser === false) {
    return (
      <DoorKnockingUnavailableView pathname={pathname} campaign={campaign} />
    )
  }
  return (
    <DoorKnockingPage
      pathname={pathname}
      campaign={campaign}
      summary={summary}
    />
  )
}
