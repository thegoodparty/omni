'use client'

import { useState, type MouseEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { FetchError } from 'ofetch'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@styleguide'
import { clientRequest } from 'gpApi/typed-request'
import { useOrganization } from '@shared/organization-picker'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { useSnackbar } from 'helpers/useSnackbar'
import { LOCKED_LIST_MESSAGE } from '../shared/constants'
import type { SegmentResponse } from '../shared/contacts-types'
import { useContactsTable } from '../ContactsTableProvider'
import { outreachAudienceListsKey } from 'app/dashboard/outreach/v2/audience/useOutreachAudience'

interface DeleteListDialogProps {
  segment: SegmentResponse
  open: boolean
  onOpenChange: (open: boolean) => void
}

// Standalone destructive-confirm dialog: it navigates back to the lists
// index after a delete, and carries the 409-locked handling gp-api added for
// this ticket's dependency (ENG-10703 guards DELETE the same as PUT).
export default function DeleteListDialog({
  segment,
  open,
  onOpenChange,
}: DeleteListDialogProps) {
  const { selectList, isWinContext, isWinContextReady } = useContactsTable()
  const orgSlug = useOrganization()?.slug
  const queryClient = useQueryClient()
  const { successSnackbar, errorSnackbar } = useSnackbar()
  const [isDeleting, setIsDeleting] = useState(false)

  // AlertDialogAction is a Radix DialogPrimitive.Close under the hood — a
  // click always closes the dialog unless the handler calls
  // preventDefault() synchronously (Radix checks event.defaultPrevented
  // right after the click, it doesn't await this async handler). Without
  // this, a generic (non-409) delete failure would still visually close the
  // confirm dialog out from under the user before the error toast lands.
  const handleDelete = async (
    event: MouseEvent<HTMLButtonElement>,
  ): Promise<void> => {
    event.preventDefault()
    setIsDeleting(true)
    try {
      await clientRequest('DELETE /v1/voters/voter-file/filter/:id', {
        id: String(segment.id),
      })
      await queryClient.invalidateQueries({
        queryKey: ['custom-segments', orgSlug],
      })
      // Same endpoint backs the outreach audience picker's list cache; drop the
      // deleted list there too so it can't be re-selected.
      await queryClient.invalidateQueries({
        queryKey: outreachAudienceListsKey(orgSlug),
      })
      // ENG-10767: the shared Contacts-group event rather than a CRM-only
      // one, so the "lists deleted" chart stays one continuous series.
      // Ready-gated like the surface's other events so an unsettled mode
      // can't emit the wrong context.
      if (isWinContextReady) {
        trackEvent(EVENTS.Contacts.SegmentDeleted, {
          context: isWinContext ? 'win' : 'serve',
        })
      }
      successSnackbar('List deleted')
      onOpenChange(false)
      // Shallow (ENG-10725): the detail surface is a sheet over the index
      // now, so leaving the deleted list's /lists/<id> URL must not remount
      // the page through the loading boundary.
      selectList(null)
    } catch (error) {
      if (error instanceof FetchError && error.status === 409) {
        errorSnackbar(LOCKED_LIST_MESSAGE, { autoHideDuration: 6000 })
        await queryClient.invalidateQueries({
          queryKey: ['custom-segments', orgSlug],
        })
        await queryClient.invalidateQueries({
          queryKey: outreachAudienceListsKey(orgSlug),
        })
        onOpenChange(false)
        return
      }
      errorSnackbar('Failed to delete list')
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="z-[2000]">
        <AlertDialogHeader>
          <AlertDialogTitle>
            <span className="font-normal">Are you sure you want to delete</span>{' '}
            {segment.name || 'this list'}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            This can not be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={isDeleting}
            onClick={handleDelete}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
