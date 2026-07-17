'use client'

import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { FetchError } from 'ofetch'
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from '@styleguide'
import { clientRequest } from 'gpApi/typed-request'
import { useOrganization } from '@shared/organization-picker'
import { useSnackbar } from 'helpers/useSnackbar'
import { MAX_SEGMENT_NAME_LENGTH } from '../shared/segments.util'
import type { SegmentResponse } from '../shared/contacts-types'

const LOCKED_MESSAGE =
  'This list was just used for outreach and is now locked — duplicate it to make changes.'

interface RenameListDialogProps {
  segment: SegmentResponse
  open: boolean
  onOpenChange: (open: boolean) => void
}

// Editable-name affordance for an unlocked list (locked design). A locked
// list never shows this dialog — ListDetailPage swaps it for "Duplicate to
// edit" once `firstUsedForOutreachAt` is set — but the PUT can still 409 if
// outreach launches elsewhere while this dialog is open (ENG-10703 stamps
// firstUsedForOutreachAt atomically). That race lands in the same
// now-locked messaging, not a generic error toast.
export default function RenameListDialog({
  segment,
  open,
  onOpenChange,
}: RenameListDialogProps) {
  const orgSlug = useOrganization()?.slug
  const queryClient = useQueryClient()
  const { successSnackbar, errorSnackbar } = useSnackbar()
  const [name, setName] = useState(segment.name ?? '')

  useEffect(() => {
    if (open) setName(segment.name ?? '')
  }, [open, segment.name])

  const invalidateSegments = () =>
    queryClient.invalidateQueries({ queryKey: ['custom-segments', orgSlug] })

  const renameMutation = useMutation({
    mutationFn: (nextName: string) =>
      clientRequest('PUT /v1/voters/voter-file/filter/:id', {
        id: String(segment.id),
        name: nextName,
      }).then((res) => res.data),
    onSuccess: async () => {
      successSnackbar('List renamed')
      await invalidateSegments()
      onOpenChange(false)
    },
    onError: async (error: unknown) => {
      if (error instanceof FetchError && error.status === 409) {
        successSnackbar(LOCKED_MESSAGE, { autoHideDuration: 6000 })
        await invalidateSegments()
        onOpenChange(false)
        return
      }
      errorSnackbar('Failed to rename list')
    },
  })

  const trimmedName = name.trim()
  const canSubmit =
    trimmedName.length > 0 &&
    trimmedName.length <= MAX_SEGMENT_NAME_LENGTH &&
    !renameMutation.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename list</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="list-name-input">List name</Label>
          <Input
            id="list-name-input"
            value={name}
            maxLength={MAX_SEGMENT_NAME_LENGTH}
            onChange={(event) => setName(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            {trimmedName.length}/{MAX_SEGMENT_NAME_LENGTH}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!canSubmit}
            loading={renameMutation.isPending}
            onClick={() => renameMutation.mutate(trimmedName)}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
