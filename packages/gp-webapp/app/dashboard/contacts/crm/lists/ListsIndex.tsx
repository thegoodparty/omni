'use client'

import { useQuery } from '@tanstack/react-query'
import { Button, Card, UserIcon } from '@styleguide'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { districtStatsQueryOptions } from 'app/dashboard/polls/shared/queries'
import { useContactsTable } from '../ContactsTableProvider'
import { useShowContactProModal } from '../ContactProModal'
import { useOpenChannelPicker } from '../shared/channelPicker/ChannelPickerProvider'
import {
  getContactsLabels,
  WIN_NEW_CONTACTS_LABELS,
} from '../../../shared/contactsLabels'
import { ALL_SEGMENTS } from '../shared/constants'
import ListCard from './ListCard'
import { CitizensPanelListCard } from './CitizensPanelListCard'
import { isCivicPanelAudienceList } from 'app/dashboard/outreach/v2/audience/civicPanelAudienceList.util'

// The Lovable design's first list row: the whole (unfiltered) universe.
// Count comes from the same GET /v1/contacts/stats query DistrictStatCard
// already holds warm (React Query dedupes on the shared key) — the
// list-detail aggregates (a slower, whole-district query with no warm cache
// of its own) are only fetched once Details is opened, inside
// ListDetailSheet's universe mode. ENG-10778 reverses the ENG-10725
// deviation that left this row without a Details action.
const AllContactsCard = ({
  title,
  showSendOutreach,
  canUseProFeatures,
  showNewContacts,
}: {
  title: string
  showSendOutreach: boolean
  canUseProFeatures: boolean
  // Win: new contacts an import added are named next to the voters.
  showNewContacts: boolean
}) => {
  const query = useQuery(districtStatsQueryOptions)
  const newContactsCount =
    showNewContacts && query.status === 'success'
      ? (query.data.newContactsCount ?? 0)
      : 0
  const { selectList } = useContactsTable()
  const showProUpgradeModal = useShowContactProModal()
  const openChannelPicker = useOpenChannelPicker()

  // getListDetail is pro-gated like every other filtering/detail action
  // (ENG-10495) — the universe view is no exception, so a non-pro click
  // upsells instead of opening a sheet that would just 400.
  const handleDetailsClick = () => {
    if (!canUseProFeatures) {
      showProUpgradeModal(true)
      return
    }
    selectList(ALL_SEGMENTS)
  }

  return (
    <Card className="w-full gap-2 rounded-2xl p-4 shadow-xs">
      <h3 className="text-base font-semibold">
        {newContactsCount > 0
          ? WIN_NEW_CONTACTS_LABELS.allContactsTitle
          : title}
      </h3>
      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <UserIcon className="size-3.5" aria-hidden />
          {query.status !== 'success' ? (
            query.isError ? (
              'Unavailable'
            ) : (
              // Designed loading placeholder (DistrictStatCard's pattern) —
              // not the bare "—" that read as a broken/empty card.
              <div className="h-3.5 w-10 animate-pulse rounded bg-muted" />
            )
          ) : newContactsCount > 0 ? (
            WIN_NEW_CONTACTS_LABELS.votersAndNewContacts(
              query.data.totalConstituents - newContactsCount,
              newContactsCount,
            )
          ) : (
            query.data.totalConstituents.toLocaleString()
          )}
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="small"
            className="h-8 px-3 text-xs text-primary hover:bg-primary/5"
            onClick={handleDetailsClick}
          >
            Details
          </Button>
          {showSendOutreach && (
            <Button
              size="small"
              className="h-8 px-3.5 text-xs"
              onClick={() => {
                // No listId: there is no saved segment behind the unfiltered
                // universe, so the picker opens on the whole district.
                trackEvent(EVENTS.VoterData.SendOutreachClicked, {
                  surface: 'universeRow',
                })
                openChannelPicker({ kind: 'universe' })
              }}
            >
              Send outreach
            </Button>
          )}
        </div>
      </div>
    </Card>
  )
}

// ENG-10725 (Lovable pixel parity): full-width row cards in the page's 560px
// column — an "All voters" universe row first, then one row per saved list.
export default function ListsIndex() {
  const { customSegments, isWinContext, isWinContextReady, canUseProFeatures } =
    useContactsTable()
  const labels = getContactsLabels(isWinContext)

  // ENG-10749: Serve outreach is deferred, and /dashboard/outreach dead-ends
  // for an eo- org, so the outreach affordance is Win-only. Waiting for
  // isWinContextReady keeps the button from flashing at a Serve user while
  // the mode resolves.
  const showSendOutreach = isWinContextReady && isWinContext
  // A civic panel invite's audience is the outreach's record, not a list the
  // official keeps: the panel's one list is the built-in Civic panel row. The
  // list the outreach picker saves for "Your civic panel" is that same
  // audience, so it stays out too.
  const savedLists = customSegments.filter(
    (segment) =>
      segment.civicPanelInvite !== true && !isCivicPanelAudienceList(segment),
  )

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">{labels.listsSectionTitle}</h2>
        <p className="text-sm text-muted-foreground">
          {labels.listsSectionSubtitle}
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <AllContactsCard
          title={labels.allContactsTitle}
          showSendOutreach={showSendOutreach}
          canUseProFeatures={canUseProFeatures}
          showNewContacts={isWinContext}
        />
        <CitizensPanelListCard />
        {savedLists.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            You haven&apos;t created any lists yet.
          </p>
        ) : (
          savedLists.map((segment) => (
            <ListCard key={segment.id} segment={segment} />
          ))
        )}
      </div>
    </section>
  )
}
