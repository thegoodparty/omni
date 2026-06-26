'use client'

import { useCallback, useEffect, useState } from 'react'
import { useUser } from '@shared/hooks/useUser'
import { clientRequest } from 'gpApi/typed-request'
import { reportErrorToSentry } from '@shared/sentry'
import type { ElectedOffice } from 'gpApi/api-endpoints'
import { buildDisabledRanges } from 'app/serve/onboarding/termDates.shared'
import { ElectedOfficeTermDatesModal } from './ElectedOfficeTermDatesModal'

// Prompt "settled" dashboard offices missing a term bound — those that either
// completed serve onboarding (legacy/prefill EOs we lack dates for) OR reached
// office by winning a campaign (the "I won" flow, marked by a `campaignId`).
// Both already onboarded and land on the dashboard, so the modal is their only
// gap-filler for term dates. A genuine serve LEAD still mid-onboarding
// (onboardingCompletedAt == null AND no campaign) is deliberately excluded: it
// supplies both dates via the onboarding term-dates step, and it never reaches
// the dashboard shell where this modal mounts — prompting it would double-prompt
// or block the flow.
const isMissingTermDates = (office: ElectedOffice): boolean =>
  (office.onboardingCompletedAt != null || office.campaignId != null) &&
  (!office.termStartDate || !office.termEndDate)

/**
 * Globally prompts a signed-in elected official to supply term dates whenever a
 * settled office they own (onboarding complete OR win-origin) is missing a start
 * or end date — regardless of which dashboard page they're on. Non-EO users (no
 * offices), genuine serve leads still mid-onboarding, and EOs with complete dates
 * see nothing. Mounted in the shared dashboard shell.
 */
export function ElectedOfficeTermDatesModalController(): React.JSX.Element | null {
  const [user, , isUserLoading] = useUser()
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
      reportErrorToSentry(err, { context: 'electedOfficeTermDatesModal.load' })
      setOffices([])
    }
  }, [])

  useEffect(() => {
    if (isUserLoading || !user) return
    void loadOffices()
  }, [isUserLoading, user, loadOffices])

  if (!offices || dismissed) return null

  const target = offices.find(isMissingTermDates)
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
