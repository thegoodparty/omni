import { useId, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ListContactUploadsResponse } from '@goodparty_org/contracts'
import {
  Alert,
  AlertDescription,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  CircleAlertIcon,
  Input,
  Label,
  Skeleton,
} from '@styleguide'
import { clientRequest } from 'gpApi/typed-request'
import { useOrganization } from '@shared/organization-picker'
import {
  contactUploadKey,
  contactUploadsKey,
  invalidateImportedPeople,
} from './importContactsApi'
import {
  UPLOAD_HISTORY_PATH,
  getImportContactsCopy,
} from './importContactsCopy'

// Undo takes away the people only this import added. Their notes and activity
// stay recorded but no longer show, so the dialog says so before the user
// commits, and holds the button until it knows.
export const UndoImportDialog = ({
  uploadId,
  open,
  onOpenChange,
  isWin,
}: {
  uploadId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  isWin: boolean
}) => {
  const COPY = getImportContactsCopy(isWin)
  const orgSlug = useOrganization()?.slug
  const queryClient = useQueryClient()
  const router = useRouter()
  const confirmInputId = useId()
  const confirmInputRef = useRef<HTMLInputElement>(null)
  const [confirmText, setConfirmText] = useState('')

  const preview = useQuery({
    queryKey: [...contactUploadKey(orgSlug, uploadId), 'undo-preview'],
    queryFn: async () =>
      (
        await clientRequest('GET /v1/contact-uploads/:id/undo-preview', {
          id: uploadId,
        })
      ).data,
    enabled: open,
    staleTime: 0,
  })

  const undo = useMutation({
    mutationFn: () =>
      clientRequest('DELETE /v1/contact-uploads/:id', { id: uploadId }),
    onSuccess: () => {
      queryClient.setQueryData<ListContactUploadsResponse>(
        contactUploadsKey(orgSlug),
        (list) =>
          list && {
            uploads: list.uploads.filter((upload) => upload.id !== uploadId),
          },
      )
      void queryClient.invalidateQueries({
        queryKey: contactUploadsKey(orgSlug),
        exact: true,
      })
      void invalidateImportedPeople(queryClient, orgSlug)
      router.push(UPLOAD_HISTORY_PATH)
    },
  })

  // Held until the page changes, so the dialog never shows the import again.
  const busy = undo.isPending || undo.isSuccess
  const canUndo =
    !!preview.data && !busy && confirmText.trim().toUpperCase() === 'UNDO'

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return
        if (!next) {
          undo.reset()
          setConfirmText('')
        }
        onOpenChange(next)
      }}
    >
      <AlertDialogContent
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          confirmInputRef.current?.focus()
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{COPY.undo.title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div>
              {preview.data ? (
                COPY.undo.body(preview.data.removedPeopleCount)
              ) : preview.isError ? null : (
                <Skeleton className="h-5 w-full" />
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {preview.data?.hasActivity && (
          <Alert variant="destructive" icon={<CircleAlertIcon />}>
            <AlertDescription>{COPY.undo.hasActivity}</AlertDescription>
          </Alert>
        )}
        {(preview.isError || undo.isError) && (
          <Alert variant="destructive" icon={<CircleAlertIcon />}>
            <AlertDescription>
              {preview.isError ? COPY.undo.loadFailed : COPY.undo.failed}
            </AlertDescription>
          </Alert>
        )}
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (canUndo) undo.mutate()
          }}
        >
          <Label htmlFor={confirmInputId}>{COPY.undo.confirmLabel}</Label>
          <Input
            ref={confirmInputRef}
            id={confirmInputId}
            value={confirmText}
            onChange={(event) => setConfirmText(event.target.value)}
            disabled={busy}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
          />
        </form>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>
            {COPY.undo.cancel}
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={!canUndo}
            onClick={(event) => {
              event.preventDefault()
              undo.mutate()
            }}
          >
            {COPY.undo.confirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
