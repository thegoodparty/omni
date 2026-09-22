'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { OutreachDetail } from '@goodparty_org/contracts'
import DashboardLayout from '../shared/DashboardLayout'
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
  SERVE_SMS_SURFACE,
  SmsFlow,
} from 'app/dashboard/outreach/v2/sms/SmsFlow'
import {
  fetchServeOutreachDetail,
  useSeedOutreachDetail,
} from 'app/dashboard/outreach/v2/useOutreachDetail'
import type { HistoryRow } from 'app/dashboard/outreach/v2/historyStatus.util'
import { useNativeDoorKnockingFlag } from '@shared/experiments/nativeDoorKnockingFlag'
import { useServeSmsFlag } from '@shared/experiments/serveSmsFlag'
import { clientRequest } from 'gpApi/typed-request'

interface ConstituentOutreachPageProps {
  pathname?: string
  outreaches?: HistoryRow[]
}

// The four wired channels. Door knocking joined them in 3.0: a Serve turf
// now gets an outreach envelope like every other channel's, so it has a row
// here at all, and `GET /v1/outreach/serve/:id` fills its `doorKnocking`
// detail block — which is what makes the row worth opening. Anything left
// off this list renders as plain content rather than a dead clickable.
//
// `text` is a Serve SMS send (the spine type the serve create writes; there
// is no Peerly `p2p` row on this surface). Deliberately NOT gated on
// `serve-sms-outreach`: only an org that has already sent has a text row at
// all, and an org whose flag is later turned off would otherwise lose the
// results for a send it paid for. The flag gates the way IN, not the record
// of what already went out.
const isDrawerRow = (row: HistoryRow): boolean =>
  row.outreachType === OUTREACH_TYPES.socialMedia ||
  row.outreachType === OUTREACH_TYPES.nativePhoneBanking ||
  row.outreachType === OUTREACH_TYPES.nativeDoorKnocking ||
  row.outreachType === OUTREACH_TYPES.text

const ConstituentOutreachContent = () => {
  const router = useRouter()
  const [outreaches, setOutreaches] = useOutreach()
  const [detailsRow, setDetailsRow] = useState<HistoryRow | null>(null)
  const [socialFlowOpen, setSocialFlowOpen] = useState(false)
  const [phoneBankingFlowOpen, setPhoneBankingFlowOpen] = useState(false)
  const [smsFlowOpen, setSmsFlowOpen] = useState(false)
  // This card IS the treatment surface, so the exposure is tracked here (the
  // hook's default) rather than suppressed. `ready` is read as well as
  // `enabled`: a variant is `undefined` while it resolves, so gating on
  // `enabled` alone renders the three-card grid and then pops a fourth card
  // in — the flash the feature-flags doc names as the top anti-pattern.
  // Until it resolves this surface is the pre-SMS one, unchanged.
  const { ready: smsFlagReady, enabled: smsFlagEnabled } = useServeSmsFlag()
  const smsMounted = smsFlagReady && smsFlagEnabled
  // The follow-up list the results drawer just saved, handed to the flow as
  // its audience so "Call them back" lands on the who step already answered.
  const [followUpListId, setFollowUpListId] = useState<number | undefined>()
  const seedOutreachDetail = useSeedOutreachDetail()
  // Whether this rail offers door knocking at all. The door-knocking page gate
  // is the treatment surface, so no exposure is tracked here.
  const nativeDoorKnocking = useNativeDoorKnockingFlag(false)

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

  // Mirrors OutreachHubPage's refetchOutreaches, org-scoped. A paid SMS send
  // only exists after the server finalizes it, so there is no create response
  // to seed a row from the way social and phone banking have — the list is
  // re-read instead.
  //
  // Best-effort, deliberately, and on two levels. `ignoreResponseError`
  // mirrors `page.tsx` on this same route: `ofetch.raw` throws on any non-2xx
  // and the `ElectedOffice` can go away between the access check and the
  // read, so without it a 4xx becomes an exception rather than `ok: false`.
  // The try/catch then covers the network level, which no flag reaches.
  //
  // Both matter because of where this runs. It is awaited by `SmsFlow`'s
  // `handleScheduled`, which is awaited by `SmsReviewStep`'s completion
  // handler, whose rejection path is the checkout form's `onError` — an
  // error snackbar and a payment-failure state. The money has already moved
  // by then. A stale history list is strictly better than telling someone
  // their successful payment failed.
  const refetchOutreaches = async () => {
    try {
      const { ok, data } = await clientRequest(
        'GET /v1/outreach/serve',
        {},
        { ignoreResponseError: true },
      )
      if (ok) {
        setOutreaches(data ?? [])
      }
    } catch {
      // Intentionally empty: a failed refresh leaves the previously loaded
      // rows in place, and the next page load reads the list again. Nothing
      // here is worth failing a completed send over. See above.
    }
  }

  return (
    <div className="mx-auto w-full max-w-7xl p-4 lg:p-6">
      <ServeChannelCards
        onSocialClick={() => setSocialFlowOpen(true)}
        onPhoneBankingClick={() => setPhoneBankingFlowOpen(true)}
        // Undefined while the flag is off or still resolving, which is what
        // keeps the card out of the grid entirely.
        onSmsClick={smsMounted ? () => setSmsFlowOpen(true) : undefined}
        // A navigation, not a flow: door knocking's create wizard is drawn
        // over its own map, which is a route rather than a drawer, and the map
        // is most of what the flow is for. `?create=1` so the card still opens
        // the wizard like the other two cards open theirs, rather than landing
        // on the rail and asking for one more press.
        onDoorKnockingClick={() =>
          router.push('/dashboard/door-knocking?create=1')
        }
        showDoorKnocking={
          nativeDoorKnocking.ready && nativeDoorKnocking.enabled
        }
      />
      <SocialFlow
        open={socialFlowOpen}
        onClose={() => setSocialFlowOpen(false)}
        onSaved={handleSocialSaved}
        surface={SERVE_SOCIAL_SURFACE}
      />
      <PhoneBankingFlow
        open={phoneBankingFlowOpen}
        onClose={() => {
          setPhoneBankingFlowOpen(false)
          // Spent on close, so pressing the tile afterwards opens a plain
          // flow rather than silently reusing the follow-up audience.
          setFollowUpListId(undefined)
        }}
        onSaved={handlePhoneBankingSaved}
        surface={SERVE_PHONE_BANKING_SURFACE}
        preselectedListId={followUpListId}
      />
      {/* Mounted only behind the flag, not merely rendered closed: with the
          flag off there is no flow in the tree at all, so no Serve SMS
          request can be reached from this page by any route. No
          `tcrCompliance` — 10DLC registration is a candidate committee's
          obligation and a Serve org has none, which is why
          SERVE_SMS_SURFACE drops the paid_for_by standards rule too. */}
      {smsMounted && (
        <SmsFlow
          open={smsFlowOpen}
          onClose={() => setSmsFlowOpen(false)}
          onScheduled={refetchOutreaches}
          surface={SERVE_SMS_SURFACE}
        />
      )}
      <OutreachHistoryTable
        rows={outreaches ?? []}
        onRowClick={setDetailsRow}
        rowClickable={isDrawerRow}
        detailFetcher={fetchServeOutreachDetail}
        isServe
      />
      <OutreachDetailsDrawer
        row={detailsRow}
        onOpenChange={(open) => {
          if (!open) setDetailsRow(null)
        }}
        detailFetcher={fetchServeOutreachDetail}
        isServe
        onCallFollowUpList={(listId) => {
          // Close the drawer first: the flow is a full-screen sheet, and two
          // stacked sheets is the thing the CRM's own drawers avoid.
          setDetailsRow(null)
          setFollowUpListId(listId)
          setPhoneBankingFlowOpen(true)
        }}
      />
    </div>
  )
}

const ConstituentOutreachPage = ({
  pathname,
  outreaches = [],
}: ConstituentOutreachPageProps): React.JSX.Element => {
  return (
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
  )
}

export default ConstituentOutreachPage
