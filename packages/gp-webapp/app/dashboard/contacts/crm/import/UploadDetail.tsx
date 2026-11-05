'use client'

import { useCallback, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CONTACT_UPLOAD_UNDOABLE_STATUSES } from '@goodparty_org/contracts'
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  ArrowLeftIcon,
  Button,
  Card,
  ChevronRightIcon,
  CircleAlertIcon,
  Skeleton,
  cn,
} from '@styleguide'
import DashboardLayout from 'app/dashboard/shared/DashboardLayout'
import { NeedsInputReview } from './NeedsInputReview'
import ImportContactsWizard from './ImportContactsWizard'
import { ProcessedRows } from './ProcessedRows'
import { SkippedRows } from './SkippedRows'
import { UndoImportDialog } from './UndoImportDialog'
import { UploadStatusText } from './UploadStatusText'
import { clientRequest } from 'gpApi/typed-request'
import { useOrganization } from '@shared/organization-picker'
import { contactUploadsKey, useContactUpload } from './importContactsApi'
import {
  UPLOAD_HISTORY_PATH,
  formatUploadDate,
  getImportContactsCopy,
} from './importContactsCopy'

const REVIEW_ID = 'needs-input-review'

export const UploadDetail = ({
  uploadId,
  isWin,
}: {
  uploadId: string
  isWin: boolean
}) => {
  const COPY = getImportContactsCopy(isWin)
  const uploadQuery = useContactUpload(uploadId)
  const upload = uploadQuery.data
  const queryClient = useQueryClient()
  const orgSlug = useOrganization()?.slug
  const router = useRouter()
  const [reviewDirty, setReviewDirty] = useState(false)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [undoOpen, setUndoOpen] = useState(false)
  const onReviewDirtyChange = useCallback(
    (dirty: boolean) => setReviewDirty(dirty),
    [],
  )
  const leave = () =>
    reviewDirty ? setConfirmLeave(true) : router.push(UPLOAD_HISTORY_PATH)
  const [openRows, setOpenRows] = useState<'skipped' | 'invalid' | null>(null)

  const retry = useMutation({
    mutationFn: async () =>
      (
        await clientRequest('POST /v1/contact-uploads/:id/retry', {
          id: uploadId,
        })
      ).data,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: contactUploadsKey(orgSlug) }),
  })

  type CountRow = {
    label: string
    value: number
    note?: string
    opens?: 'skipped' | 'invalid' | 'review'
  }
  // Left: the file's summary, always shown. Right: what asks the user to
  // act, only while it has people in it.
  const totals: CountRow[] = upload
    ? [
        {
          label: COPY.detail.imported,
          value: upload.matchedCount + upload.newCount,
        },
        {
          label: COPY.detail.matched,
          value: upload.matchedCount,
          note:
            upload.updatedCount > 0
              ? COPY.detail.updated(upload.updatedCount)
              : undefined,
        },
        { label: COPY.detail.added, value: upload.newCount },
      ]
    : []
  const toAct: CountRow[] = upload
    ? [
        {
          label: COPY.detail.needsInput,
          value: upload.needsInputCount,
          opens: 'review' as const,
        },
        {
          label: COPY.detail.invalid,
          value: upload.invalidCount,
          opens: 'invalid' as const,
        },
        {
          label: COPY.detail.skipped,
          value: upload.skippedCount,
          opens: 'skipped' as const,
        },
      ].filter((row) => row.value > 0)
    : []

  const openCount = (opens: 'skipped' | 'invalid' | 'review') => {
    if (opens !== 'review') {
      setOpenRows(opens)
      return
    }
    const review = document.getElementById(REVIEW_ID)
    review?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    review?.focus({ preventScroll: true })
  }

  const showsRows =
    upload !== undefined &&
    upload.status !== 'processing' &&
    upload.rowCount !== null

  return (
    <DashboardLayout
      pathname="/dashboard/contacts"
      showAlert={false}
      // Empty until the upload loads rather than a placeholder that would
      // flash and then change.
      navHeader={{ label: upload?.name ?? '' }}
    >
      {/* Voter Data's full-bleed white top bar, holding the way back. */}
      <div className="sticky top-0 z-10 -mx-2 -mt-2 flex shrink-0 items-center justify-between gap-4 border-b border-border bg-background px-4 py-3 md:-mx-4 md:-mt-4 md:px-6">
        <Button asChild variant="ghost">
          <Link
            href={UPLOAD_HISTORY_PATH}
            aria-label={COPY.detail.backToHistory}
            onClick={(event) => {
              if (!reviewDirty) return
              event.preventDefault()
              setConfirmLeave(true)
            }}
          >
            <ArrowLeftIcon className="size-4" aria-hidden />
            {COPY.back}
          </Link>
        </Button>
        {upload &&
          CONTACT_UPLOAD_UNDOABLE_STATUSES.some(
            (status) => status === upload.status,
          ) && (
            <Button
              type="button"
              variant="outline"
              onClick={() => setUndoOpen(true)}
            >
              {COPY.undo.open}
            </Button>
          )}
      </div>
      <div className="mx-auto mt-8 flex w-full max-w-[720px] flex-col gap-6 px-2 pb-32 md:px-0">
        {upload ? (
          <div className="flex flex-col gap-2">
            {/* The title bar holds the name on a desktop, and a phone hides
                that bar, so the name shows here below lg. */}
            <h2 className="text-lg font-semibold lg:hidden">{upload.name}</h2>
            {/* The file and its details on the left, the status on the
                right, as a history row reads. On a phone everything starts
                at the left edge and the status takes the last line. */}
            <div className="flex flex-col items-start gap-2 md:flex-row md:justify-between md:gap-4">
              <p className="min-w-0 text-sm text-muted-foreground">
                {COPY.detail.meta(
                  upload.fileName,
                  formatUploadDate(upload.createdAt),
                  upload.uploadedBy?.name ?? null,
                  upload.rowCount,
                )}
              </p>
              <span className="shrink-0">
                <UploadStatusText status={upload.status} isWin={isWin} />
              </span>
            </div>
          </div>
        ) : (
          <Skeleton className="h-5 w-64" />
        )}

        {uploadQuery.isError && (
          <Alert variant="destructive" icon={<CircleAlertIcon />}>
            <AlertDescription>{COPY.detail.loadFailed}</AlertDescription>
          </Alert>
        )}

        {upload?.status === 'processing' && (
          <Alert variant="info" icon={<CircleAlertIcon />}>
            <AlertDescription>{COPY.detail.processing}</AlertDescription>
          </Alert>
        )}

        {upload?.status === 'failed' && (
          <Alert variant="destructive" icon={<CircleAlertIcon />}>
            <AlertDescription>
              {retry.isError
                ? COPY.detail.retryFailed
                : (upload.failureReason ?? COPY.detail.failed)}
            </AlertDescription>
            {upload.failureKind === 'file' ? (
              // A file that failed for what is in it fails again, so the way
              // on is a fixed file.
              <AlertAction>
                <Button
                  type="button"
                  variant="alertOutline"
                  size="small"
                  onClick={() => setWizardOpen(true)}
                >
                  {COPY.detail.importNewFile}
                </Button>
              </AlertAction>
            ) : (
              <AlertAction>
                <Button
                  type="button"
                  variant="alertOutline"
                  size="small"
                  onClick={() => retry.mutate()}
                  loading={retry.isPending}
                >
                  {COPY.detail.tryAgain}
                </Button>
              </AlertAction>
            )}
          </Alert>
        )}

        {showsRows && (
          <>
            {/* Voter Data's stat card (DistrictStatCard): the label on the
                left and the number on the right, the summary first, then what
                to act on. */}
            <Card className="w-full gap-0 rounded-lg py-0">
              {[...totals, ...toAct].map((count, index) => {
                const opens = count.opens
                const className = cn(
                  // Tall enough for a label with its note under it, so a row with a
                  // note is no taller than the rest.
                  'flex min-h-14 w-full items-center justify-between gap-4 px-4 py-2 text-left',
                  index > 0 && 'border-t border-border',
                )
                const content = (
                  <>
                    <span className="flex flex-col">
                      <span className="text-sm">{count.label}</span>
                      {count.note && (
                        <span className="text-xs text-muted-foreground">
                          {count.note}
                        </span>
                      )}
                    </span>
                    <span className="flex shrink-0 items-center gap-2 text-lg font-semibold">
                      {count.value.toLocaleString()}
                      {/* Every row keeps the arrow's room, so the numbers line
                          up whether or not the row opens something. */}
                      <span className="flex size-4 items-center" aria-hidden>
                        {opens && (
                          <ChevronRightIcon
                            size={16}
                            className="text-muted-foreground"
                          />
                        )}
                      </span>
                    </span>
                  </>
                )
                return opens ? (
                  <div
                    key={count.label}
                    role="button"
                    tabIndex={0}
                    aria-haspopup={opens === 'review' ? undefined : 'dialog'}
                    onClick={() => openCount(opens)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        openCount(opens)
                      }
                    }}
                    className={cn(
                      className,
                      'cursor-pointer transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-primary-focus focus-visible:outline-none focus-visible:ring-inset',
                    )}
                  >
                    {content}
                  </div>
                ) : (
                  <div key={count.label} className={className}>
                    {content}
                  </div>
                )
              })}
            </Card>

            {upload.needsInputCount > 0 && (
              <div id={REVIEW_ID} tabIndex={-1} className="outline-none">
                <NeedsInputReview
                  upload={upload}
                  isWin={isWin}
                  onDirtyChange={onReviewDirtyChange}
                  onDecideLater={leave}
                />
              </div>
            )}

            <ProcessedRows upload={upload} isWin={isWin} />

            {openRows && (
              <SkippedRows
                upload={upload}
                outcome={openRows}
                isWin={isWin}
                onClose={() => setOpenRows(null)}
              />
            )}
          </>
        )}
      </div>
      <UndoImportDialog
        uploadId={uploadId}
        open={undoOpen}
        onOpenChange={setUndoOpen}
        isWin={isWin}
      />
      <ImportContactsWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        isWin={isWin}
      />
      <AlertDialog open={confirmLeave} onOpenChange={setConfirmLeave}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{COPY.review.discardTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {COPY.review.discardBody}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{COPY.review.keepEditing}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setConfirmLeave(false)
                router.push(UPLOAD_HISTORY_PATH)
              }}
            >
              {COPY.review.discard}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  )
}
