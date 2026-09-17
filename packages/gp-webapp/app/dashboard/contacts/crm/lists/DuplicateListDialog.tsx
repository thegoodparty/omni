'use client'

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
import type { SegmentResponse } from '../shared/contacts-types'
import { useDuplicateList } from './useDuplicateList'

interface DuplicateListDialogProps {
  segment: SegmentResponse
  open: boolean
  onOpenChange: (open: boolean) => void
}

// ENG-10943: useDuplicateList reposts the list's saved CRITERIA as a new
// filter, not a frozen membership snapshot — the copy re-evaluates against
// current people-db data and can legitimately land on a different member
// count than the original (live drift, or activityConditions re-resolving).
// A single click used to fire that create call with no warning, which
// stakeholder QA read as "duplication lost voters." This confirms the
// honest tradeoff before the request goes out, for every duplicate entry
// point (ListCard's kebab, and both of ListDetailSheet's).
export default function DuplicateListDialog({
  segment,
  open,
  onOpenChange,
}: DuplicateListDialogProps) {
  const duplicateMutation = useDuplicateList()

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="z-[2000]">
        <AlertDialogHeader>
          <AlertDialogTitle>
            Duplicate &quot;{segment.name || 'this list'}&quot;?
          </AlertDialogTitle>
          <AlertDialogDescription>
            The copy re-runs this list&apos;s filters against current data, so
            its member count can differ from the original.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={duplicateMutation.isPending}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={duplicateMutation.isPending}
            onClick={(event) => {
              // Same reasoning as DeleteListDialog: AlertDialogAction is a
              // Radix Close under the hood and closes on click unless this
              // handler prevents it synchronously — keep the dialog open
              // until the create call actually resolves.
              event.preventDefault()
              duplicateMutation.mutate(segment, {
                onSuccess: () => onOpenChange(false),
              })
            }}
          >
            Duplicate
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
