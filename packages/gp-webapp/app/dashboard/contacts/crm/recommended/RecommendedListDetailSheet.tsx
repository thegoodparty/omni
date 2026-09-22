import { useQuery } from '@tanstack/react-query'
import {
  Button,
  CalendarIcon,
  ClockIcon,
  DollarSignIcon,
  DownloadIcon,
  DrawerTitle,
  LockIcon,
  MessageSquareIcon,
  UsersRoundIcon,
} from '@styleguide'
import type { RecommendedList } from '@goodparty_org/contracts'
import { useOrganization } from '@shared/organization-picker'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { getContactsLabels } from '../../../shared/contactsLabels'
import { useContactsTable } from '../ContactsTableProvider'
import CrmSheet from '../shared/CrmSheet'
import { useContactsDownload } from '../shared/useContactsDownload'
import { useOpenChannelPicker } from '../shared/channelPicker/ChannelPickerProvider'
import ReachabilityGrid from '../lists/ReachabilityGrid'
import { SectionLabel, StatTile } from '../lists/ListDetailSection'
import { recommendedListDetailQueryOptions } from './recommendedListDetail.query'
import { trackRecommendedSendOutreach } from './recommendedListOutreach.util'

interface RecommendedListDetailSheetProps {
  recommendation: RecommendedList | null
  onClose: () => void
}

// The detail sheet for a recommended list the candidate has not saved. Same
// sheet and sections as a saved list (ListDetailSheet) — the history tiles
// and section read empty rather than disappearing, since nothing has been
// sent to a list that does not exist — minus the kebab, which edits, copies
// and deletes a saved row. The figures come from the inline-filter twin of
// list-detail, fed the same builder translation the flows persist, so what
// this shows is what saving the list would show; Download streams the same
// universe by variant.
export default function RecommendedListDetailSheet({
  recommendation,
  onClose,
}: RecommendedListDetailSheetProps) {
  const orgSlug = useOrganization()?.slug
  const {
    canUseProFeatures,
    isWinContext,
    isWinContextReady,
    voterDataUnavailable,
  } = useContactsTable()
  const labels = getContactsLabels(isWinContext)
  const openChannelPicker = useOpenChannelPicker()
  // A non-pro user has no upsell wired here — like ListDetailSheet, the
  // button communicates the lock through its icon alone.
  const { downloadFromHref, isPreparing } = useContactsDownload({
    canUseProFeatures,
  })

  const detailQuery = useQuery({
    ...recommendedListDetailQueryOptions(
      orgSlug,
      // A closed sheet has no recommendation; the placeholder only shapes
      // the disabled query's key and is never fetched.
      recommendation ?? {
        variant: 'introNeverIded',
        intent: 'introduce',
        filter: {},
        count: 0,
        copy: { title: '', criteriaSummary: '' },
        existingFilterId: null,
      },
    ),
    enabled:
      recommendation !== null && canUseProFeatures && !voterDataUnavailable,
  })

  const demographics = detailQuery.data?.demographics
  const statValue = (formatted: string | null | undefined): string =>
    detailQuery.isError ? 'Unavailable' : (formatted ?? '—')

  const handleDownload = () => {
    if (!recommendation) return
    downloadFromHref(
      `/api/v1/campaigns/mine/recommended-lists/${recommendation.variant}/download`,
      { context: isWinContext ? 'win' : 'serve' },
      () => {
        // Same gates as ListDetailSheet: only the cookie-confirmed success
        // branch, only once the mode has settled, and only with a size to
        // report — never a listSize-less event.
        const listSize = detailQuery.data?.demographics.people
        if (isWinContextReady && listSize !== undefined) {
          trackEvent(
            isWinContext
              ? EVENTS.VoterData.ListExported
              : EVENTS.ConstituentData.ListExported,
            { listSize, surface: 'recommendedDetail' },
          )
        }
      },
    )
  }

  return (
    <CrmSheet
      open={recommendation !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      header={
        <DrawerTitle className="text-base font-semibold">
          {recommendation?.copy.title ?? 'List details'}
        </DrawerTitle>
      }
      footer={
        recommendation ? (
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              className="size-11 shrink-0 p-0"
              aria-label="Download list"
              onClick={handleDownload}
              loading={isPreparing}
            >
              {isPreparing ? null : !canUseProFeatures ? (
                <LockIcon className="size-4" />
              ) : (
                <DownloadIcon className="size-4" />
              )}
            </Button>
            <Button
              className="h-11 flex-1 text-sm"
              onClick={() => {
                trackRecommendedSendOutreach(
                  recommendation,
                  'recommendedDetail',
                )
                // The prototype swaps this drawer for "Choose a channel"; two
                // full-height sheets never stack.
                onClose()
                openChannelPicker({ kind: 'recommended', recommendation })
              }}
            >
              Send outreach
            </Button>
          </div>
        ) : undefined
      }
    >
      {recommendation && (
        <div className="flex flex-col gap-6">
          <h2 className="text-base font-semibold">{labels.listDetailsTitle}</h2>

          <div className="flex flex-col gap-2">
            <SectionLabel>List filters</SectionLabel>
            <p className="text-sm">{recommendation.copy.criteriaSummary}</p>
          </div>

          <div className="flex flex-col gap-2">
            <SectionLabel>List demographics</SectionLabel>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <StatTile
                icon={<UsersRoundIcon size={16} className="shrink-0" />}
                label="People"
                value={statValue(
                  demographics
                    ? demographics.people.toLocaleString()
                    : undefined,
                )}
              />
              <StatTile
                icon={<CalendarIcon size={16} className="shrink-0" />}
                label="Avg age"
                value={statValue(
                  demographics?.avgAge != null
                    ? String(Math.round(demographics.avgAge))
                    : demographics
                      ? '—'
                      : undefined,
                )}
              />
              <StatTile
                icon={<DollarSignIcon size={16} className="shrink-0" />}
                label="Avg income"
                value={statValue(
                  demographics?.avgIncome != null
                    ? `$${Math.round(demographics.avgIncome).toLocaleString()}`
                    : demographics
                      ? '—'
                      : undefined,
                )}
              />
              {/* No saved row, so no outreach to date: the two history tiles
                  read empty, as they do for a saved list that has not been
                  sent to yet, rather than disappearing. */}
              <StatTile
                icon={<ClockIcon size={16} className="shrink-0" />}
                label="Last outreach"
                value="—"
              />
              <StatTile
                icon={<MessageSquareIcon size={16} className="shrink-0" />}
                label="Last method"
                value="—"
              />
            </dl>
          </div>

          <ReachabilityGrid
            reachability={detailQuery.data?.reachability}
            isLoading={detailQuery.isLoading}
            isError={detailQuery.isError}
            isWinContext={isWinContextReady && isWinContext}
          />

          <div className="flex flex-col gap-2">
            <h3 className="text-base font-semibold">
              Outreach campaign history
            </h3>
            <p className="text-sm text-muted-foreground">
              Every campaign you&apos;ve sent, most recent first.
            </p>
            <p className="text-sm text-muted-foreground">No outreach yet.</p>
          </div>
        </div>
      )}
    </CrmSheet>
  )
}
