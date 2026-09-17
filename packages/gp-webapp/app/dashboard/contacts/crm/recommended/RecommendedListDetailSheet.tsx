import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import {
  Button,
  CalendarIcon,
  DollarSignIcon,
  DrawerTitle,
  UsersRoundIcon,
} from '@styleguide'
import type { RecommendedList } from '@goodparty_org/contracts'
import { clientRequest } from 'gpApi/typed-request'
import { useOrganization } from '@shared/organization-picker'
import { builderFiltersFromRecommendation } from 'app/dashboard/outreach/v2/audience/recommendedListMapping.util'
import { getContactsLabels } from '../../../shared/contactsLabels'
import { useContactsTable } from '../ContactsTableProvider'
import CrmSheet from '../shared/CrmSheet'
import { transformVoterFileFiltersForBackend } from '../shared/voterFileFilterTransform.util'
import ReachabilityGrid from '../lists/ReachabilityGrid'
import { SectionLabel, StatTile } from '../lists/ListDetailSection'
import {
  recommendedListOutreachHref,
  trackRecommendedSendOutreach,
} from './recommendedListOutreach.util'

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

  const detailQuery = useQuery({
    queryKey: ['recommended-list-detail', orgSlug, recommendation?.variant],
    queryFn: async () => {
      // Guarded by `enabled` below.
      if (!recommendation) throw new Error('No recommendation open')
      const { filter } = recommendation
      const { data } = await clientRequest('POST /v1/contacts/list-detail', {
        ...transformVoterFileFiltersForBackend(
          builderFiltersFromRecommendation(filter),
        ),
        ...(filter.supportStatus?.length
          ? { supportStatus: filter.supportStatus }
          : {}),
        ...(filter.precincts?.length ? { precincts: filter.precincts } : {}),
      })
      return data
    },
    enabled:
      recommendation !== null && canUseProFeatures && !voterDataUnavailable,
    refetchOnWindowFocus: false,
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
          <Button className="h-11 w-full text-sm" asChild>
            <Link
              href={recommendedListOutreachHref(recommendation)}
              onClick={() =>
                trackRecommendedSendOutreach(
                  recommendation,
                  'recommendedDetail',
                )
              }
            >
              Send outreach
            </Link>
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
