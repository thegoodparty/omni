'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { FetchError } from 'ofetch'
import { DoorKnockingTurf } from '@goodparty_org/contracts'
import { Button, IconButton, Trash2Icon } from '@styleguide'
import { clientRequest } from 'gpApi/typed-request'
import { useSnackbar } from 'helpers/useSnackbar'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { ConfirmDeleteDialog } from 'app/dashboard/shared/ConfirmDeleteDialog'
import { TURFS_QUERY_KEY } from './turfQueries'

// A gp-api deployed behind this client, still running the `assertNotLocked`
// that `delete` used to carry. No current server can produce it: a routed turf
// is tombstoned rather than refused, and every turf is routed. Kept as the
// snackbar for that one deployment skew, because a 409 is permanent from the
// browser's point of view and needs a sentence rather than "Try again".
const STALE_SERVER_DELETE_MESSAGE =
  'This list has already been knocked, so it can no longer be deleted.'

interface DeleteTurfControlProps {
  turf: DoorKnockingTurf
  // The page holds its own references to this turf (map scope, camera focus),
  // which would otherwise keep masking the map to a list that no longer
  // exists.
  onDeleted: (turf: DoorKnockingTurf) => void
  // Which trigger to draw, if any. The details sheet has room for the word;
  // `icon` is the bare trash for a dense row. `none` renders the confirmation
  // alone, for the rail — its trigger is a menu item, and a Radix menu unmounts
  // its own content on select, which would take this dialog down with it before
  // it could ever open. Same behavior in all three — the 409 rule has one
  // implementation, which is the whole reason this is a component and not a
  // second copy of the mutation.
  trigger?: 'button' | 'icon' | 'none'
  // Only read when `trigger` is `none`, where the caller outlives the trigger
  // and therefore has to own the open state.
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export default function DeleteTurfControl({
  turf,
  onDeleted,
  trigger = 'button',
  open,
  onOpenChange,
}: DeleteTurfControlProps) {
  const queryClient = useQueryClient()
  const { successSnackbar, errorSnackbar } = useSnackbar()
  const [ownConfirmOpen, setOwnConfirmOpen] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const controlled = trigger === 'none'
  const confirmOpen = controlled ? Boolean(open) : ownConfirmOpen
  const setConfirmOpen = (next: boolean) => {
    if (controlled) onOpenChange?.(next)
    else setOwnConfirmOpen(next)
  }
  const deleteTurf = useMutation({
    mutationFn: () =>
      clientRequest('DELETE /v1/door-knocking/turfs/:id', {
        id: String(turf.id),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: TURFS_QUERY_KEY,
      })
      trackEvent(EVENTS.DoorKnocking.ListDeleted, { turfId: turf.id })
      successSnackbar('List deleted')
      setConfirmOpen(false)
      onDeleted(turf)
    },
    onError: async (error) => {
      if (error instanceof FetchError && error.status === 409) {
        // It will refuse the retry too, so the confirm closes rather than
        // leaving a Delete that can only 409 again, and the reason goes to a
        // snackbar that outlives the dialog.
        setConfirmOpen(false)
        setDeleteError(null)
        errorSnackbar(STALE_SERVER_DELETE_MESSAGE, { autoHideDuration: 6000 })
        await queryClient.invalidateQueries({
          queryKey: TURFS_QUERY_KEY,
        })
        return
      }
      // Generic failures are worth retrying, so the dialog stays put.
      setDeleteError('The list could not be deleted. Try again.')
    },
  })

  const openConfirm = () => {
    setDeleteError(null)
    setConfirmOpen(true)
  }

  return (
    <>
      {trigger === 'icon' ? (
        <IconButton
          variant="ghost"
          size="small"
          // Named for the list, and distinct from the details sheet's own
          // trigger: both are mounted at once (the sheet is an overlay over
          // the rail), so one accessible name would be ambiguous to a screen
          // reader and to a test alike.
          aria-label={`Delete ${turf.name} list`}
          className="text-destructive hover:bg-destructive/10"
          onClick={openConfirm}
        >
          <Trash2Icon size={16} />
        </IconButton>
      ) : trigger === 'none' ? null : (
        <Button
          size="small"
          variant="outline"
          // Named for the turf so it doesn't collide with the confirm
          // dialog's own "Delete", for screen readers and tests alike.
          aria-label={`Delete ${turf.name}`}
          className="shrink-0 text-destructive hover:bg-destructive/10"
          onClick={openConfirm}
        >
          <Trash2Icon size={14} />
          Delete
        </Button>
      )}
      <ConfirmDeleteDialog
        open={confirmOpen}
        onOpenChange={(next) => {
          setConfirmOpen(next)
          if (!next) setDeleteError(null)
        }}
        title={`Delete ${turf.name}?`}
        // One sentence rather than two, because there is one delete now: a
        // list is born with the route it was billed for, so deleting it is
        // always a tombstone and never destroys the route, the frozen doors or
        // the walk in outreach history. The hard-delete branch — a drawing
        // nobody had paid for yet — has no state left to describe.
        description="This list leaves your rail for good. The route you paid for, the doors it froze and the walk in your outreach history are all kept, and no logged knocks are affected."
        onConfirm={() => deleteTurf.mutate()}
        confirming={deleteTurf.isPending}
        errorMessage={deleteError}
      />
    </>
  )
}
