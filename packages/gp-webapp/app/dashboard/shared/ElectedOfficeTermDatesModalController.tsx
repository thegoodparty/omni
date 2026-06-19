'use client'

import { useCallback, useEffect, useState } from 'react'
import { useUser } from '@shared/hooks/useUser'
import { clientRequest } from 'gpApi/typed-request'
import { reportErrorToSentry } from '@shared/sentry'
import type { ElectedOffice } from 'gpApi/api-endpoints'
import { buildDisabledRanges } from 'app/serve/onboarding/termDates.shared'
import { ElectedOfficeTermDatesModal } from './ElectedOfficeTermDatesModal'

// Only "settled" offices are prompted: those that have completed serve
// onboarding but are still missing a term bound (legacy/prefill EOs we already
// lack dates for). An office that hasn't completed onboarding
// (onboardingCompletedAt == null) — including a just-won candidate mid win→serve
// flow — supplies both dates via the onboarding term-dates step (now enforced by
// the completion guard), so prompting it here would block the dashboard with no
// gap to fill.
const isMissingTermDates = (office: ElectedOffice): boolean =>
  office.onboardingCompletedAt != null &&
  (!office.termStartDate || !office.termEndDate)

/**
 * Globally prompts a signed-in elected official to supply term dates whenever a
 * settled office they own (onboarding complete) is missing a start or end date —
 * regardless of which dashboard page they're on. Non-EO users (no offices), EOs
 * still in onboarding, and EOs with complete dates see nothing. Mounted in the
 * shared dashboard shell.
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
