'use client'

import { useState } from 'react'
import { Button, Input, Label } from '@styleguide'
import { useQueryClient } from '@tanstack/react-query'
import Modal from '@shared/utils/Modal'
import ServeOfficePicker from 'app/serve/onboarding/ServeOfficePicker'
import { clientRequest } from 'gpApi/typed-request'
import { ORGANIZATIONS_QUERY_KEY } from '@shared/organization-picker'
import { reportErrorToSentry } from '@shared/sentry'
import { useSnackbar } from 'helpers/useSnackbar'
import type { SelectedOffice } from 'app/onboarding/components/onboardingTypes'

interface ElectedOfficeSelectionModalProps {
  show: boolean
  onClose: () => void
  // The active org's slug — the office is recorded on the organization, not the
  // elected-office row, so the change is a PATCH to this slug.
  organizationSlug?: string
  // Prefilled into the ZIP search so the picker opens scoped to the official's
  // area without a campaign record to read from.
  defaultZip?: string
  onSaved?: () => void
}

/**
 * Office picker for an elected official. Unlike the candidate
 * CampaignOfficeSelectionModal (which writes to the campaign), this records the
 * chosen position on the active organization via PATCH /v1/organizations/:slug —
 * the same write the serve onboarding office step performs — so it never touches
 * a campaign that may not exist.
 */
export function ElectedOfficeSelectionModal({
  show,
  onClose,
  organizationSlug,
  defaultZip,
  onSaved,
}: ElectedOfficeSelectionModalProps): React.JSX.Element {
  const queryClient = useQueryClient()
  const { errorSnackbar } = useSnackbar()
  const [zip, setZip] = useState(defaultZip ?? '')
  const [selected, setSelected] = useState<SelectedOffice | undefined>()
  const [customMode, setCustomMode] = useState(false)
  const [customName, setCustomName] = useState('')
  const [saving, setSaving] = useState(false)

  const canSave = customMode ? customName.trim().length > 0 : !!selected
  const reset = (): void => {
    setSelected(undefined)
    setCustomMode(false)
    setCustomName('')
  }

  const handleSave = async (): Promise<void> => {
    if (!canSave || saving || !organizationSlug) return
    setSaving(true)
    try {
      const res = await clientRequest('PATCH /v1/organizations/:slug', {
        slug: organizationSlug,
        ballotReadyPositionId: customMode
          ? null
          : (selected?.positionId ?? null),
        customPositionName: customMode ? customName.trim() : null,
      })
      if (!res.ok) throw new Error('Failed to update office')
      await queryClient.invalidateQueries({ queryKey: ORGANIZATIONS_QUERY_KEY })
      onSaved?.()
      reset()
      onClose()
    } catch (err) {
      reportErrorToSentry(err, {
        context: 'electedOfficeSelectionModal.save',
        organizationSlug,
      })
      errorSnackbar('Something went wrong updating your office. Try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={show}
      closeCallback={() => {
        reset()
        onClose()
      }}
      boxClassName="w-[95vw] lg:w-[60vw]"
    >
      <div className="space-y-4 text-left">
        <div>
          <h2 className="m-0 text-xl font-semibold text-foreground">
            Change office
          </h2>
          <p className="m-0 mt-1 text-sm text-muted-foreground">
            Find the office you currently hold.
          </p>
        </div>

        {customMode ? (
          <div className="space-y-2">
            <Label htmlFor="eo-custom-office">Office name</Label>
            <Input
              id="eo-custom-office"
              placeholder="Enter your office name"
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
            />
            <Button
              variant="link"
              size="small"
              onClick={() => {
                setCustomMode(false)
                setCustomName('')
              }}
            >
              Search for my office instead
            </Button>
          </div>
        ) : (
          <ServeOfficePicker
            zip={zip}
            selected={selected}
            onZipChange={setZip}
            onSelect={setSelected}
            onCantFindOffice={() => setCustomMode(true)}
          />
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button
            variant="outline"
            onClick={() => {
              reset()
              onClose()
            }}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSave} loading={saving}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  )
}
