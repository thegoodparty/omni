'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@styleguide/components/ui/dialog'
import { Button } from '@styleguide/components/ui/button'
import { clientRequest } from 'gpApi/typed-request'
import { reportErrorToSentry } from '@shared/sentry'
import { useSnackbar } from 'helpers/useSnackbar'
import type { ElectedOffice } from 'gpApi/api-endpoints'
import {
  TermDatesFields,
  termDateError,
  termDatesValid,
  toApiDate,
  toDate,
  type DisabledRange,
} from 'app/serve/onboarding/termDates.shared'

interface ElectedOfficeTermDatesModalProps {
  office: ElectedOffice
  // The user's OTHER offices as disabled ranges, so the prompt enforces the
  // same no-overlap rule as the serve onboarding term-dates step.
  otherRanges: DisabledRange[]
  onSaved: () => void
  onDismiss: () => void
  // Voluntary edit surface (e.g. the profile "Office details" card) vs. the
  // forced gap-filler prompt. When dismissible, escape / outside-click close
  // the modal and the copy reflects editing rather than a required action.
  dismissible?: boolean
  title?: string
  description?: string
  saveLabel?: string
}

/**
 * Dashboard prompt shown to any elected official whose office is missing a term
 * start or end date. Reuses the serve onboarding term-date picker + validation
 * so the two surfaces never diverge. By default escape / outside-click are
 * blocked so the prompt isn't dismissed by accident; the explicit close still
 * lets the user defer (it reappears on the next dashboard load until the dates
 * are saved). Pass `dismissible` to reuse it as a voluntary term-date editor.
 */
export function ElectedOfficeTermDatesModal({
  office,
  otherRanges,
  onSaved,
  onDismiss,
  dismissible = false,
  title = 'Add your term dates',
  description = 'We need your term start and end dates to keep your GoodParty.org tools accurate. Please add them to continue.',
  saveLabel = 'Save term dates',
}: ElectedOfficeTermDatesModalProps): React.JSX.Element {
  const { errorSnackbar } = useSnackbar()
  const [termStartDate, setTermStartDate] = useState<Date | undefined>(
    toDate(office.termStartDate),
  )
  const [termEndDate, setTermEndDate] = useState<Date | undefined>(
    toDate(office.termEndDate),
  )
  const [saving, setSaving] = useState(false)

  const error = termDateError(termStartDate, termEndDate, otherRanges)
  const valid = termDatesValid(termStartDate, termEndDate, otherRanges)

  const handleOpenChange = (next: boolean): void => {
    if (!next) onDismiss()
  }

  const handleSubmit = async (): Promise<void> => {
    if (!valid || saving) return
    setSaving(true)
    try {
      const res = await clientRequest('PUT /v1/elected-office/:id', {
        id: office.id,
        termStartDate: toApiDate(termStartDate),
        termEndDate: toApiDate(termEndDate),
      })
      if (!res.ok) throw new Error('Failed to save term dates')
      onSaved()
    } catch (err) {
      reportErrorToSentry(err, {
        context: 'electedOfficeTermDatesModal.save',
        electedOfficeId: office.id,
      })
      errorSnackbar(
        'Something went wrong saving your term dates. Please try again.',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-2xl"
        onEscapeKeyDown={dismissible ? undefined : (e) => e.preventDefault()}
        onInteractOutside={dismissible ? undefined : (e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <TermDatesFields
          termStartDate={termStartDate}
          termEndDate={termEndDate}
          onStartChange={setTermStartDate}
          onEndChange={setTermEndDate}
          otherRanges={otherRanges}
          error={error}
        />

        <DialogFooter>
          <Button onClick={handleSubmit} disabled={!valid || saving}>
            {saving ? 'Saving…' : saveLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
