'use client'

import { useCallback, useEffect, useState } from 'react'
import { useUser } from '@shared/hooks/useUser'
import { useOrganization } from '@shared/organization-picker'
import { clientRequest } from 'gpApi/typed-request'
import { reportClientError } from '@shared/observability/reportClientError'
import type { ElectedOffice } from 'gpApi/api-endpoints'
import { buildDisabledRanges } from 'app/serve/onboarding/termDates.shared'
import { ElectedOfficeTermDatesModal } from './ElectedOfficeTermDatesModal'

// Someone who just won finishes the warm welcome without a term step: their
// term starts on the first meeting they confirmed, or is not known yet. The
// product asks them later, not the moment they land on the Serve home.
const WELCOME_GRACE_MS = 24 * 60 * 60 * 1000

// Prompt offices that finished serve onboarding but lack a term bound (legacy
// and prefill offices, and a winner whose term the welcome could not fill).
// An office still mid-onboarding is sent back there by the dashboard, so
// prompting it here would double-prompt.
const isMissingTermDates = (office: ElectedOffice): boolean => {
  if (office.onboardingCompletedAt == null) return false
  if (office.termStartDate && office.termEndDate) return false
  const justWelcomed =
    office.campaignId != null &&
    Date.now() - Date.parse(office.onboardingCompletedAt) < WELCOME_GRACE_MS
  return !justWelcomed
}

/**
 * Prompts a signed-in elected official to supply term dates when the office
 * backing their currently selected organization (onboarding complete) is
 * missing a start or end date — regardless of which dashboard page they're on.
 * Scoped to the selected org: a campaign org selected (no `electedOfficeId`),
 * non-EO users, offices still mid-onboarding, and EOs with complete dates see
 * nothing. Mounted in the shared dashboard shell.
 */
export function ElectedOfficeTermDatesModalController(): React.JSX.Element | null {
  const [user, , isUserLoading] = useUser()
  const selectedOrg = useOrganization()
  const [offices, setOffices] = useState<ElectedOffice[] | null>(null)
  // Lets the user defer the prompt for the current mount; it returns on the
  // next dashboard load (fresh fetch) until the dates are saved.
  const [dismissed, setDismissed] = useState(false)

  const loadOffices = useCallback(async (): Promise<void> => {
    try {
      const res = await clientRequest(
        'GET /v1/elected-office/mine',
        {},
        { ignoreResponseError: true },
      )
      setOffices(res.ok ? (res.data as ElectedOffice[]) : [])
    } catch (err) {
      reportClientError(err, { context: 'electedOfficeTermDatesModal.load' })
      setOffices([])
    }
  }, [])

  useEffect(() => {
    if (isUserLoading || !user) return
    void loadOffices()
  }, [isUserLoading, user, loadOffices])

  if (!offices || dismissed) return null

  // Only prompt for the office backing the selected org. A campaign org (no
  // electedOfficeId) never prompts, even if the user owns an EO missing dates.
  if (!selectedOrg?.electedOfficeId) return null

  const target = offices.find(
    (o) => o.id === selectedOrg.electedOfficeId && isMissingTermDates(o),
  )
  if (!target) return null

  const otherRanges = buildDisabledRanges(offices, target.id)

  return (
    <ElectedOfficeTermDatesModal
      office={target}
      otherRanges={otherRanges}
      // Refetch after a save so a second office still missing dates is prompted
      // next, and the modal closes once every office is complete.
      onSaved={() => void loadOffices()}
      onDismiss={() => setDismissed(true)}
    />
  )
}
