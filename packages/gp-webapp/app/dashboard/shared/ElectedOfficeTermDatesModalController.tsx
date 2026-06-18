'use client'

import { useCallback, useEffect, useState } from 'react'
import { useUser } from '@shared/hooks/useUser'
import { clientRequest } from 'gpApi/typed-request'
import { reportErrorToSentry } from '@shared/sentry'
import type { ElectedOffice } from 'gpApi/api-endpoints'
import { buildDisabledRanges } from 'app/serve/onboarding/termDates.shared'
import { ElectedOfficeTermDatesModal } from './ElectedOfficeTermDatesModal'

const isMissingTermDates = (office: ElectedOffice): boolean =>
  !office.termStartDate || !office.termEndDate

/**
 * Globally prompts a signed-in elected official to supply term dates whenever
 * any office they own is missing a start or end date — regardless of which
 * dashboard page they're on. Non-EO users (no offices) and EOs with complete
 * dates see nothing. Mounted in the shared dashboard shell.
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
