'use client'

import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { DoorKnockingTurf } from '@goodparty_org/contracts'
import {
  Button,
  CheckCircleIcon,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from '@styleguide'
import { clientRequest } from 'gpApi/typed-request'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { useSnackbar } from 'helpers/useSnackbar'
import {
  MAX_TURF_NAME_LENGTH,
  TURF_COLORS,
  turfColorLabel,
  turfColorTick,
  TURFS_QUERY_KEY,
} from './turfQueries'

// Name and color are the only editable fields, and now that is the endpoint's
// own shape rather than a restraint this dialog shows: PUT
// /v1/door-knocking/turfs/:id no longer accepts `geoPoly` at all, because the
// polygon is what the frozen route was computed from and every list is routed
// from creation. So there is no lock left to trip and no 409 to handle — the
// trigger is live at every stage, which is what makes a list renameable for
// its whole life instead of only before its first knock.

interface EditTurfDialogProps {
  turf: DoorKnockingTurf
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function EditTurfDialog({
  turf,
  open,
  onOpenChange,
}: EditTurfDialogProps) {
  const queryClient = useQueryClient()
  const { successSnackbar, errorSnackbar } = useSnackbar()
  const [name, setName] = useState(turf.name)
  const [color, setColor] = useState<string>(turf.color)

  // Reseed on open rather than on mount: the dialog outlives a cancel, so a
  // discarded edit must not be waiting there the next time it opens.
  useEffect(() => {
    if (open) {
      setName(turf.name)
      setColor(turf.color)
    }
  }, [open, turf.name, turf.color])

  const editTurf = useMutation({
    mutationFn: (input: { name: string; color: string }) =>
      clientRequest('PUT /v1/door-knocking/turfs/:id', {
        id: String(turf.id),
        ...input,
      }).then((res) => res.data),
    onSuccess: async (_data, input) => {
      trackEvent(EVENTS.DoorKnocking.ListEdited, {
        turfId: turf.id,
        renamed: input.name !== turf.name,
        recolored: input.color !== turf.color,
      })
      successSnackbar('List updated')
      await queryClient.invalidateQueries({
        queryKey: TURFS_QUERY_KEY,
      })
      onOpenChange(false)
    },
    onError: () => {
      errorSnackbar('The list could not be updated. Try again.')
    },
  })

  const trimmedName = name.trim()
  const unchanged = trimmedName === turf.name && color === turf.color
  const canSubmit = trimmedName.length > 0 && !unchanged && !editTurf.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit list</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="turf-edit-name">List name</Label>
            <Input
              id="turf-edit-name"
              value={name}
              maxLength={MAX_TURF_NAME_LENGTH}
              onChange={(event) => setName(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {trimmedName.length}/{MAX_TURF_NAME_LENGTH}
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Label>List color</Label>
            <div className="flex gap-2.5">
              {TURF_COLORS.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-label={turfColorLabel(option)}
                  aria-pressed={color === option}
                  className={`flex h-8 w-8 items-center justify-center rounded-full border-2 ${
                    color === option
                      ? 'border-foreground'
                      : 'border-transparent'
                  }`}
                  style={{ backgroundColor: option }}
                  onClick={() => setColor(option)}
                >
                  {/* Inverts with the swatch, same rule as the walk list's
                      stop numeral — a white tick vanishes on green and amber. */}
                  {color === option && (
                    <CheckCircleIcon
                      size={16}
                      aria-hidden="true"
                      style={{ color: turfColorTick(option) }}
                    />
                  )}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Colors tell your lists apart on the map.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!canSubmit}
            loading={editTurf.isPending}
            onClick={() => editTurf.mutate({ name: trimmedName, color })}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
