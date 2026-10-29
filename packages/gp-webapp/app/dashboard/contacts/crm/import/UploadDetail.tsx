'use client'

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
  Skeleton,
} from '@styleguide'
import { NeedsInputReview } from './NeedsInputReview'
import { ProcessedRows } from './ProcessedRows'
import { UploadStatusText } from './UploadStatusText'
import { clientRequest } from 'gpApi/typed-request'
import { useOrganization } from '@shared/organization-picker'
import { contactUploadsKey, useContactUpload } from './importContactsApi'
import {
  SERVE_IMPORT_CONTACTS_COPY,
  UPLOAD_HISTORY_PATH,
  formatUploadDate,
} from './importContactsCopy'

const COPY = SERVE_IMPORT_CONTACTS_COPY

export const UploadDetail = ({ uploadId }: { uploadId: string }) => {
  const uploadQuery = useContactUpload(uploadId)
  const upload = uploadQuery.data
  const queryClient = useQueryClient()
  const orgSlug = useOrganization()?.slug

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

  return (
    <div className="mx-auto flex w-full max-w-[880px] flex-col gap-6 px-4 pb-32 pt-4 lg:pt-8">
      <div className="flex items-start gap-3">
        <Link
          href={UPLOAD_HISTORY_PATH}
          aria-label={COPY.detail.backToHistory}
          className="flex px-1 py-2.5 text-foreground sm:py-1.5"
        >
          <ArrowLeftIcon className="size-[22px]" aria-hidden />
        </Link>
        {upload ? (
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-[22px] font-bold text-foreground sm:text-[28px]">
                {upload.name}
              </h1>
              <UploadStatusText status={upload.status} />
            </div>
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
          <Skeleton className="h-9 w-64" />
        )}
      </div>

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
            {retry.isError ? COPY.detail.retryFailed : COPY.detail.failed}
          </AlertDescription>
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
        </Alert>
      )}

      {upload && upload.status !== 'processing' && (
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

          {upload.needsInputCount > 0 && <NeedsInputReview upload={upload} />}

          <ProcessedRows upload={upload} />
        </>
      )}
    </div>
  )
}
