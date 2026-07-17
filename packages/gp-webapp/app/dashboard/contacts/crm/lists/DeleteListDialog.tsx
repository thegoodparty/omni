'use client'

import { useState, type MouseEvent } from 'react'
import { useRouter } from 'next/navigation'
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
import { useSnackbar } from 'helpers/useSnackbar'
import { LOCKED_LIST_MESSAGE } from '../shared/constants'
import type { SegmentResponse } from '../shared/contacts-types'

interface DeleteListDialogProps {
  segment: SegmentResponse
  open: boolean
  onOpenChange: (open: boolean) => void
}

// Modeled on the legacy DeleteSegment.tsx confirm pattern, but a standalone
// component: this is a new CRM surface (app/dashboard/contacts/CLAUDE.md
// convention keeps new CRM code out of [[...attr]]/components/) and it needs
// a different post-delete action (navigate back to the lists index, not
// reset an in-page segment picker) plus the 409-locked handling gp-api added
// for this ticket's dependency (ENG-10703 guards DELETE the same as PUT).
export default function DeleteListDialog({
  segment,
  open,
  onOpenChange,
}: DeleteListDialogProps) {
  const router = useRouter()
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
      successSnackbar('List deleted')
      onOpenChange(false)
      router.push('/dashboard/contacts')
    } catch (error) {
      if (error instanceof FetchError && error.status === 409) {
        errorSnackbar(LOCKED_LIST_MESSAGE, { autoHideDuration: 6000 })
        await queryClient.invalidateQueries({
          queryKey: ['custom-segments', orgSlug],
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
