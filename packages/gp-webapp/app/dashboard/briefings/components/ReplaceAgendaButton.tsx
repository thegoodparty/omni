'use client'

import { useState } from 'react'
import { Button, UploadIcon } from '@styleguide'
import UploadAgendaModal from './UploadAgendaModal'

type Props = {
  meetingDate: string
  meetingName: string
  /** True while a replacement run is already processing. */
  disabled?: boolean
  size?: 'small' | 'medium'
  withIcon?: boolean
}

/**
 * "Replace agenda" for a meeting that already has a briefing. Opens the same
 * paste-or-upload modal the awaiting state uses; the new run replaces the
 * briefing row in place. Owns its modal so the row that hosts it can stay a
 * server component.
 */
export default function ReplaceAgendaButton({
  meetingDate,
  meetingName,
  disabled = false,
  size = 'medium',
  withIcon = false,
}: Props): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size={size}
        disabled={disabled}
        aria-label={`Replace agenda for ${meetingName}`}
        onClick={() => setOpen(true)}
      >
        {withIcon ? <UploadIcon className="size-4" aria-hidden /> : null}
        Replace agenda
      </Button>
      <UploadAgendaModal
        open={open}
        onOpenChange={setOpen}
        meetingDate={meetingDate}
        meetingName={meetingName}
      />
    </>
  )
}
