import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Button,
} from '@styleguide'
import { clientRequest } from 'gpApi/typed-request'
import { useContactsTable } from '../../../crm/ContactsTableProvider'
import { ReactNode, useState } from 'react'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { type SegmentResponse } from '../../../crm/shared/contacts-types'

interface DeleteSegmentProps {
  segment: SegmentResponse
  afterDeleteCallback: (deletedId: number) => void
  trigger?: ReactNode
}

export default function DeleteSegment({
  segment,
  afterDeleteCallback,
  trigger,
}: DeleteSegmentProps) {
  const { id } = segment
  const { refreshCustomSegments, isWinContext } = useContactsTable()

  const [isDeleting, setIsDeleting] = useState(false)

  const handleDelete = async (): Promise<void> => {
    try {
      setIsDeleting(true)
      await clientRequest('DELETE /v1/voters/voter-file/filter/:id', {
        id: String(id),
      })
      await refreshCustomSegments()
      afterDeleteCallback(id)
      trackEvent(EVENTS.Contacts.SegmentDeleted, {
        context: isWinContext ? 'win' : 'serve',
      })
    } catch (error) {
      console.log('Error deleting segment', error)
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        {trigger ?? (
          <Button
            variant="destructive"
            className="mt-12"
            loading={isDeleting}
            disabled={isDeleting}
          >
            Delete Segment
          </Button>
        )}
      </AlertDialogTrigger>
      <AlertDialogContent className="z-[2000]">
        <AlertDialogHeader>
          <AlertDialogTitle>
            <span className="font-normal">
              Are you sure you want to delete your custom segment
            </span>{' '}
            {segment.name}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            This can not be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={handleDelete}
          >
            Delete Segment
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
