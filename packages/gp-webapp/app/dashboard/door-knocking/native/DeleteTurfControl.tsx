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
import { turfsQueryOptions } from './turfQueries'

// What the lock still costs, now that delete is not one of the things it
// refuses. gp-api's `delete` used to run `assertNotLocked`; it no longer does —
// an unlocked turf is hard-deleted and a locked one is tombstoned, so the
// confirmation dialog is the guard and the trigger is live at every stage.
//
// The sentence stays because the lock is still real: `update` asserts it, so a
// knocked list cannot be renamed, recoloured or redrawn. It is exported because
// the details sheet prints it beside its own (hidden) Edit control, and a rule
// met in two wordings reads as two rules. It is also the snackbar for a 409,
// which this client should never see against a current gp-api and would only
// see against one deployed behind it — permanent from the browser's point of
// view either way, which is why that path closes the confirm.
export const LOCKED_TURF_MESSAGE =
  'This list has already been knocked, so its route and drawn area are frozen and can no longer be changed.'

interface DeleteTurfControlProps {
  turf: DoorKnockingTurf
  // Read from the LIVE row by both callers, never from a captured snapshot.
  // It no longer gates the trigger — it decides what the confirmation says is
  // about to happen, because the two deletes destroy very different amounts.
  locked: boolean
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
  locked,
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
        queryKey: turfsQueryOptions.queryKey,
      })
      trackEvent(EVENTS.DoorKnocking.ListDeleted, { turfId: turf.id })
      successSnackbar('List deleted')
      setConfirmOpen(false)
      onDeleted(turf)
    },
    onError: async (error) => {
      if (error instanceof FetchError && error.status === 409) {
        // A server that still refuses a knocked list — a gp-api deployed behind
        // this client. It will refuse the retry too, so the confirm closes
        // rather than leaving a Delete that can only 409 again, and the reason
        // goes to a snackbar that outlives the dialog.
        setConfirmOpen(false)
        setDeleteError(null)
        errorSnackbar(LOCKED_TURF_MESSAGE, { autoHideDuration: 6000 })
        await queryClient.invalidateQueries({
          queryKey: turfsQueryOptions.queryKey,
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
        // The dialog is the guard now, so it has to say which delete is about
        // to run: an unknocked list is a drawing and really does go, while a
        // knocked one keeps the route someone was billed for and the walk in
        // outreach history — it only leaves this rail. Describing both as
        // "removed for good" would over-warn on one and under-warn on the
        // other.
        description={
          locked
            ? 'This list leaves your rail for good. The route you paid for, the doors it froze and the walk in your outreach history are all kept, and no logged knocks are affected.'
            : 'The drawn area and its filters are removed for good. The saved list stays in Contacts, and no logged knocks are affected.'
        }
        onConfirm={() => deleteTurf.mutate()}
        confirming={deleteTurf.isPending}
        errorMessage={deleteError}
      />
    </>
  )
}
