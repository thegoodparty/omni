import { useQuery } from '@tanstack/react-query'
import {
  Button,
  CalendarIcon,
  DollarSignIcon,
  DrawerTitle,
  UsersRoundIcon,
} from '@styleguide'
import type { RecommendedList } from '@goodparty_org/contracts'
import { useOrganization } from '@shared/organization-picker'
import { getContactsLabels } from '../../../shared/contactsLabels'
import { useContactsTable } from '../ContactsTableProvider'
import CrmSheet from '../shared/CrmSheet'
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
// sheet and sections as a saved list (ListDetailSheet), minus what only a
// saved row has: a kebab, a download, and outreach history. The figures
// come from the inline-filter twin of list-detail, fed the same builder
// translation the flows persist, so what this shows is what saving the
// list would show.
export default function RecommendedListDetailSheet({
  recommendation,
  onClose,
}: RecommendedListDetailSheetProps) {
  const orgSlug = useOrganization()?.slug
  const { canUseProFeatures, isWinContext, voterDataUnavailable } =
    useContactsTable()
  const labels = getContactsLabels(isWinContext)
  const openChannelPicker = useOpenChannelPicker()

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
          <Button
            className="h-11 w-full text-sm"
            onClick={() => {
              trackRecommendedSendOutreach(recommendation, 'recommendedDetail')
              // The prototype swaps this drawer for "Choose a channel"; two
              // full-height sheets never stack.
              onClose()
              openChannelPicker({ kind: 'recommended', recommendation })
            }}
          >
            Send outreach
          </Button>
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
            </dl>
          </div>

          <ReachabilityGrid
            reachability={detailQuery.data?.reachability}
            isLoading={detailQuery.isLoading}
            isError={detailQuery.isError}
          />
        </div>
      )}
    </CrmSheet>
  )
}
