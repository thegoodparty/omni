'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  AlertAction,
  AlertDescription,
  ArrowLeftIcon,
  Button,
  Card,
  ChevronRightIcon,
  CircleAlertIcon,
  Input,
  SearchIcon,
  Skeleton,
  cn,
} from '@styleguide'
import DashboardLayout from 'app/dashboard/shared/DashboardLayout'
import { NeedsInputReview } from './NeedsInputReview'
import { ProcessedRows } from './ProcessedRows'
import { SkippedRows } from './SkippedRows'
import { UploadStatusText } from './UploadStatusText'
import { clientRequest } from 'gpApi/typed-request'
import { useOrganization } from '@shared/organization-picker'
import { contactUploadsKey, useContactUpload } from './importContactsApi'
import {
  UPLOAD_HISTORY_PATH,
  formatUploadDate,
  getImportContactsCopy,
} from './importContactsCopy'

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
  const [search, setSearch] = useState('')
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

  const counts: Array<{
    label: string
    value: number
    opens?: 'skipped' | 'invalid'
  }> = upload
    ? [
        { label: COPY.detail.matched, value: upload.matchedCount },
        { label: COPY.detail.added, value: upload.newCount },
        { label: COPY.detail.needsInput, value: upload.needsInputCount },
        {
          label: COPY.detail.skipped,
          value: upload.skippedCount,
          opens: 'skipped',
        },
        {
          label: COPY.detail.invalid,
          value: upload.invalidCount,
          opens: 'invalid',
        },
        ...(upload.updatedCount > 0
          ? [{ label: COPY.detail.updated, value: upload.updatedCount }]
          : []),
        ...(upload.unchangedCount > 0
          ? [{ label: COPY.detail.unchanged, value: upload.unchangedCount }]
          : []),
      ]
    : []

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
      {/* Voter Data's full-bleed white top bar: the way back, then the
          rows' search, where Voter Data keeps its search. */}
      <div className="sticky top-0 z-10 -mx-2 -mt-2 flex shrink-0 flex-col gap-3 border-b border-border bg-background px-4 py-3 md:-mx-4 md:-mt-4 md:flex-row md:items-center md:justify-between md:px-6">
        <Button asChild variant="ghost" className="self-start md:self-auto">
          <Link
            href={UPLOAD_HISTORY_PATH}
            aria-label={COPY.detail.backToHistory}
          >
            <ArrowLeftIcon className="size-4" aria-hidden />
            {COPY.back}
          </Link>
        </Button>
        {showsRows && (
          <div className="w-full md:w-[420px]">
            <Input
              aria-label={COPY.processed.searchLabel}
              icon={<SearchIcon />}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={COPY.processed.searchPlaceholder}
            />
          </div>
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
            {upload.failureKind !== 'file' && (
              <AlertAction>
                <Button
                  type="button"
                  variant="alertFilled"
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
            {/* Voter Data's stat card (DistrictStatCard): one row per
                count, the label on the left and the number on the right,
                in two columns from md and one on a phone. */}
            <Card className="w-full gap-0 rounded-lg py-0 md:grid md:grid-cols-2">
              {[
                counts.slice(0, Math.ceil(counts.length / 2)),
                counts.slice(Math.ceil(counts.length / 2)),
              ].map((column, columnIndex) => (
                <div
                  key={columnIndex}
                  className={cn(
                    columnIndex > 0 &&
                      'border-t border-border md:border-t-0 md:border-l',
                  )}
                >
                  {column.map((count, index) => {
                    const opens = count.value > 0 ? count.opens : undefined
                    const content = (
                      <>
                        <span className="text-sm font-normal">
                          {count.label}
                        </span>
                        <span className="flex items-center gap-2 text-lg font-semibold">
                          {count.value.toLocaleString()}
                          {opens && (
                            <ChevronRightIcon
                              size={16}
                              className="text-muted-foreground"
                              aria-hidden
                            />
                          )}
                        </span>
                      </>
                    )
                    const className = cn(
                      'flex w-full items-center justify-between gap-4 px-4 py-2',
                      index > 0 && 'border-t border-border',
                    )
                    return opens ? (
                      <button
                        key={count.label}
                        type="button"
                        aria-haspopup="dialog"
                        onClick={() => setOpenRows(opens)}
                        className={cn(
                          className,
                          'cursor-pointer text-left transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-primary-focus focus-visible:outline-none focus-visible:ring-inset',
                        )}
                      >
                        {content}
                      </button>
                    ) : (
                      <div key={count.label} className={className}>
                        {content}
                      </div>
                    )
                  })}
                </div>
              ))}
            </Card>

            {upload.needsInputCount > 0 && (
              <NeedsInputReview upload={upload} isWin={isWin} />
            )}

            <ProcessedRows upload={upload} isWin={isWin} search={search} />

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
    </DashboardLayout>
  )
}
