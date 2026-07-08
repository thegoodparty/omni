'use client'

import { useEffect, useState } from 'react'
import { Button, Card } from '@styleguide'
import { getCampaign } from 'app/onboarding/shared/ajaxActions'
import { CampaignOfficeSelectionModal } from 'app/dashboard/shared/CampaignOfficeSelectionModal'
import { ElectedOfficeSelectionModal } from 'app/dashboard/shared/ElectedOfficeSelectionModal'
import { trackEvent, EVENTS } from 'helpers/analyticsHelper'
import { Campaign } from 'helpers/types'
import {
  ORGANIZATIONS_QUERY_KEY,
  useOrganization,
} from '@shared/organization-picker'
import { usePositionName } from '@shared/hooks/usePositionName'
import { useUser } from '@shared/hooks/useUser'
import {
  useElectedOffice,
  electedOfficeQueryOptions,
} from '@shared/hooks/useElectedOffice'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { clientRequest } from 'gpApi/typed-request'
import { buildDisabledRanges } from 'app/serve/onboarding/termDates.shared'
import { ElectedOfficeTermDatesModal } from 'app/dashboard/shared/ElectedOfficeTermDatesModal'
import type { ElectedOffice } from 'gpApi/api-endpoints'
import ReadField from './ReadField'

interface OfficeDetailsCardProps {
  campaign?: Campaign
}

const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000

const formatDate = (value?: string | null): string => {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

// Term length is derived (never edited here) from the elected office's term
// dates, falling back to the stored day count. The term-date picker owns edits.
const formatTermLength = (office?: ElectedOffice | null): string => {
  if (!office) return ''
  let years: number | undefined
  if (office.termStartDate && office.termEndDate) {
    const start = new Date(office.termStartDate).getTime()
    const end = new Date(office.termEndDate).getTime()
    if (!Number.isNaN(start) && !Number.isNaN(end) && end > start) {
      years = Math.round((end - start) / MS_PER_YEAR)
    }
  }
  if (
    years === undefined &&
    office.termLengthDays &&
    office.termLengthDays > 0
  ) {
    years = Math.round(office.termLengthDays / 365.25)
  }
  if (!years || years < 1) return ''
  return `${years} year${years === 1 ? '' : 's'}`
}

export default function OfficeDetailsCard(
  props: OfficeDetailsCardProps,
): React.JSX.Element {
  const organization = useOrganization()
  const positionName = usePositionName()
  const [user] = useUser()
  const { data: electedOffice } = useElectedOffice()
  const queryClient = useQueryClient()
  const isElectedOffice = !!organization?.electedOfficeId

  const [campaign, setCampaign] = useState<Campaign | undefined>(props.campaign)
  const [showModal, setShowModal] = useState(false)
  const [showTermDates, setShowTermDates] = useState(false)

  useEffect(() => {
    setCampaign(props.campaign)
  }, [props.campaign])

  // All of the user's offices, so the term-date picker can enforce the same
  // no-overlap rule as serve onboarding. Only needed in elected-office mode.
  const { data: myOffices } = useQuery<ElectedOffice[]>({
    queryKey: ['electedOffice', 'mine'],
    queryFn: async () => {
      const res = await clientRequest(
        'GET /v1/elected-office/mine',
        {},
        { ignoreResponseError: true },
      )
      return res.ok ? (res.data as ElectedOffice[]) : []
    },
    enabled: isElectedOffice,
  })

  const details = campaign?.details
  const orgState = organization?.position?.state || ''
  // An elected office has no campaign address, so location is the org's state
  // plus the official's saved ZIP; a candidate's campaign carries city/state/zip.
  const location = isElectedOffice
    ? [orgState, user?.zip].filter(Boolean).join(', ')
    : [details?.city, details?.state || orgState, details?.zip]
        .filter(Boolean)
        .join(', ')

  const handleChange = (): void => {
    trackEvent(EVENTS.Profile.OfficeDetails.ClickEdit)
    setShowModal(true)
  }

  const handleUpdate = async (): Promise<void> => {
    trackEvent(EVENTS.Profile.OfficeDetails.ClickSave)
    if (campaign) {
      const updatedCampaign = await getCampaign()
      if (updatedCampaign) {
        setCampaign(updatedCampaign)
      }
    } else {
      await queryClient.invalidateQueries({ queryKey: ORGANIZATIONS_QUERY_KEY })
    }
    setShowModal(false)
  }

  const handleEditTermDates = (): void => {
    trackEvent(EVENTS.Profile.OfficeDetails.ClickEdit)
    setShowTermDates(true)
  }

  const handleTermDatesSaved = async (): Promise<void> => {
    trackEvent(EVENTS.Profile.OfficeDetails.ClickSave)
    // Term length is derived from these dates, so refetch the office (and the
    // offices list feeding overlap validation) to refresh the display.
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: electedOfficeQueryOptions(organization?.slug).queryKey,
      }),
      queryClient.invalidateQueries({ queryKey: ['electedOffice', 'mine'] }),
    ])
    setShowTermDates(false)
  }

  return (
    <Card className="w-full max-w-[640px] gap-4 p-6">
      <div className="flex items-center justify-between">
        <h2 className="m-0 text-xl font-semibold text-foreground">
          Office details
        </h2>
        <Button size="small" onClick={handleChange}>
          Change office
        </Button>
      </div>

      <ReadField label="Position" value={positionName} placeholder />
      <ReadField label="Location" value={location} placeholder />
      {/* Term length applies to a current officeholder; election date applies
          to an in-progress campaign. */}
      {isElectedOffice ? (
        <ReadField
          label="Term length"
          value={formatTermLength(electedOffice)}
          placeholder
          action={
            electedOffice
              ? {
                  label:
                    electedOffice.termStartDate && electedOffice.termEndDate
                      ? 'Edit'
                      : 'Add',
                  onClick: handleEditTermDates,
                }
              : undefined
          }
        />
      ) : (
        <ReadField
          label="Election date"
          value={formatDate(details?.electionDate)}
          placeholder
        />
      )}

      {isElectedOffice ? (
        <ElectedOfficeSelectionModal
          show={showModal}
          onClose={() => setShowModal(false)}
          organizationSlug={organization?.slug}
          defaultZip={user?.zip ?? undefined}
          onSaved={handleUpdate}
        />
      ) : (
        <CampaignOfficeSelectionModal
          campaign={campaign}
          show={showModal}
          onClose={() => setShowModal(false)}
          onSelect={handleUpdate}
          organizationSlug={organization?.slug}
        />
      )}

      {isElectedOffice && showTermDates && electedOffice && (
        <ElectedOfficeTermDatesModal
          office={electedOffice}
          otherRanges={buildDisabledRanges(myOffices ?? [], electedOffice.id)}
          dismissible
          title="Term dates"
          description="Set your term start and end dates. Your term length is calculated from these."
          saveLabel="Save"
          onSaved={handleTermDatesSaved}
          onDismiss={() => setShowTermDates(false)}
        />
      )}
    </Card>
  )
}
