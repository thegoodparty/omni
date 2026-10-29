'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Alert,
  AlertDescription,
  ArrowLeftIcon,
  Button,
  Card,
  CircleAlertIcon,
  EmptyState,
  PlusIcon,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@styleguide'
import ImportContactsWizard from './ImportContactsWizard'
import { UploadStatusText } from './UploadStatusText'
import { useContactUploads } from './importContactsApi'
import {
  SERVE_IMPORT_CONTACTS_COPY,
  formatUploadDate,
  uploadDetailPath,
} from './importContactsCopy'

const COPY = SERVE_IMPORT_CONTACTS_COPY

const capitalize = (text: string): string =>
  text.charAt(0).toUpperCase() + text.slice(1)

export const UploadHistory = () => {
  const router = useRouter()
  const [wizardOpen, setWizardOpen] = useState(false)
  const uploadsQuery = useContactUploads()
  const uploads = [...(uploadsQuery.data?.uploads ?? [])].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  )

  const importButton = (
    <Button
      className="shrink-0 text-sm font-semibold"
      onClick={() => setWizardOpen(true)}
      icon={<PlusIcon />}
    >
      {COPY.importContacts}
    </Button>
  )

  return (
    <div className="mx-auto flex w-full max-w-[880px] flex-col gap-6 px-4 pb-32 pt-4 lg:pt-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/contacts"
            aria-label={COPY.history.backToConstituents}
            className="flex px-1 py-2.5 text-foreground sm:p-0"
          >
            <ArrowLeftIcon className="size-[22px]" aria-hidden />
          </Link>
          <div className="flex flex-col">
            <h1 className="text-[22px] font-bold text-foreground sm:text-[28px]">
              {COPY.history.title}
            </h1>
            <p className="text-sm text-muted-foreground">
              {COPY.history.caption}
            </p>
          </div>
        </div>
        {importButton}
      </div>

      {uploadsQuery.isError ? (
        <Alert variant="destructive" icon={<CircleAlertIcon />}>
          <AlertDescription>{COPY.history.loadFailed}</AlertDescription>
        </Alert>
      ) : uploadsQuery.isPending ? (
        <div
          className="flex flex-col gap-2"
          data-testid="upload-history-loading"
        >
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : uploads.length === 0 ? (
        <EmptyState
          title={COPY.history.emptyTitle}
          message={COPY.history.emptyMessage}
          action={importButton}
        />
      ) : (
        <Card className="overflow-hidden p-0">
          <Table className="w-full [&_th]:text-muted-foreground [&_th:first-child]:!pl-4 [&_td:first-child]:!pl-4 [&_th:last-child]:!pr-4 [&_td:last-child]:!pr-4">
            <TableHeader>
              <TableRow>
                <TableHead className="w-full">
                  {COPY.history.uploadColumn}
                </TableHead>
                <TableHead className="whitespace-nowrap">
                  {COPY.history.uploadedColumn}
                </TableHead>
                <TableHead className="whitespace-nowrap text-right">
                  {COPY.history.statusColumn}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {uploads.map((upload) => {
                const open = () => router.push(uploadDetailPath(upload.id))
                return (
                  <TableRow
                    key={upload.id}
                    role="button"
                    tabIndex={0}
                    className="cursor-pointer"
                    onClick={open}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        open()
                      }
                    }}
                  >
                    <TableCell className="max-w-0">
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate font-medium text-foreground">
                          {upload.name}
                        </span>
                        <span className="truncate text-sm text-muted-foreground">
                          {COPY.history.fileAndUploader(
                            upload.fileName,
                            upload.uploadedBy?.name ?? null,
                          )}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {capitalize(formatUploadDate(upload.createdAt))}
                    </TableCell>
                    <TableCell className="text-right">
                      <UploadStatusText status={upload.status} />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      <ImportContactsWizard open={wizardOpen} onOpenChange={setWizardOpen} />
    </div>
  )
}
