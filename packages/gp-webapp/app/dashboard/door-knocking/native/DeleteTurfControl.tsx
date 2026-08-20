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

// gp-api refuses to delete a knocked turf: doorKnockingTurf.delete runs
// assertNotLocked first, and lockedness IS the frozen route row, so a turf
// with logged knocks 409s.
//
// The control now RENDERS for a locked list and is disabled, where it used to
// render nothing at all. Absence was the bug: a candidate whose lists were all
// knocked saw no Delete anywhere and reported the feature as missing, which is
// exactly what an affordance that removes itself without explanation looks
// like. One wording, used three ways — the disabled control's title, the line
// the details sheet prints beside it, and the 409 snackbar — so the rule is
// never met phrased two ways.
export const LOCKED_TURF_MESSAGE =
  'This list has already been knocked, so its route is frozen and it can no longer be deleted.'

interface DeleteTurfControlProps {
  turf: DoorKnockingTurf
  // Read from the LIVE row by both callers, never from a captured snapshot: a
  // list knocked by a teammate since the rail rendered must stop offering a
  // delete that can now only 409.
  locked: boolean
  // The page holds its own references to this turf (map scope, camera focus),
  // which would otherwise keep masking the map to a list that no longer
  // exists.
  onDeleted: (turf: DoorKnockingTurf) => void
  // The rail row is a dense row of four other affordances, so it gets the icon
  // alone; the details sheet has room for the word. Same behavior either way —
  // the 409 rule has one implementation, which is the whole reason this is a
  // component and not a second copy of the mutation.
  compact?: boolean
}

export default function DeleteTurfControl({
  turf,
  locked,
  onDeleted,
  compact = false,
}: DeleteTurfControlProps) {
  const queryClient = useQueryClient()
  const { successSnackbar, errorSnackbar } = useSnackbar()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
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
        // Someone knocked it while this was open, so this is permanent, not
        // retryable: close the confirm rather than leaving an enabled Delete
        // that can only 409 again, and explain in a snackbar that outlives the
        // dialog. The refetch then flips the live row and the trigger disables
        // itself.
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

  const open = () => {
    setDeleteError(null)
    setConfirmOpen(true)
  }

  return (
    <>
      {compact ? (
        <IconButton
          // Named for the list, and distinct from the details sheet's own
          // trigger: both are mounted at once (the sheet is an overlay inside
          // the rail's container), so one accessible name would be ambiguous
          // to a screen reader and to a test alike.
          aria-label={`Delete ${turf.name} list`}
          disabled={locked}
          title={locked ? LOCKED_TURF_MESSAGE : undefined}
          onClick={open}
        >
          <Trash2Icon size={16} />
        </IconButton>
      ) : (
        <Button
          size="small"
          variant="outline"
          // Named for the turf so it doesn't collide with the confirm
          // dialog's own "Delete", for screen readers and tests alike.
          aria-label={`Delete ${turf.name}`}
          className="shrink-0 text-destructive hover:bg-destructive/10"
          disabled={locked}
          title={locked ? LOCKED_TURF_MESSAGE : undefined}
          onClick={open}
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
        description="The drawn area and its filters are removed for good. The saved list stays in Contacts, and no logged knocks are affected."
        onConfirm={() => deleteTurf.mutate()}
        confirming={deleteTurf.isPending}
        errorMessage={deleteError}
      />
    </>
  )
}
