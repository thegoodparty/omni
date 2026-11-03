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
  CircleAlertIcon,
  Input,
  SearchIcon,
  Skeleton,
} from '@styleguide'
import DashboardLayout from 'app/dashboard/shared/DashboardLayout'
import { NeedsInputReview } from './NeedsInputReview'
import { ProcessedRows } from './ProcessedRows'
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

  const counts = upload
    ? [
        { label: COPY.detail.matched, value: upload.matchedCount },
        { label: COPY.detail.added, value: upload.newCount },
        { label: COPY.detail.needsInput, value: upload.needsInputCount },
        { label: COPY.detail.skipped, value: upload.skippedCount },
        { label: COPY.detail.invalid, value: upload.invalidCount },
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
      <div className="-mx-2 -mt-2 flex shrink-0 flex-col gap-3 border-b border-border bg-background px-4 py-3 md:-mx-4 md:-mt-4 md:flex-row md:items-center md:justify-between md:px-6">
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
          <div className="flex flex-wrap items-center gap-3">
            <UploadStatusText status={upload.status} isWin={isWin} />
            <p className="text-sm text-muted-foreground">
              {COPY.detail.meta(
                upload.fileName,
                formatUploadDate(upload.createdAt),
                upload.uploadedBy?.name ?? null,
                upload.rowCount,
              )}
            </p>
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
            <Card className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-3">
              {counts.map((count) => (
                <div key={count.label} className="flex flex-col">
                  <span className="text-2xl font-semibold text-foreground">
                    {count.value.toLocaleString()}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {count.label}
                  </span>
                </div>
              ))}
            </Card>

            {upload.needsInputCount > 0 && (
              <NeedsInputReview upload={upload} isWin={isWin} />
            )}

            <ProcessedRows upload={upload} isWin={isWin} search={search} />
          </>
        )}
      </div>
    </DashboardLayout>
  )
}
