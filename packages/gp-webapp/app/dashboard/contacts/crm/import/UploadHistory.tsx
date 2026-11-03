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
  UploadIcon,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@styleguide'
import DashboardLayout from 'app/dashboard/shared/DashboardLayout'
import ImportContactsWizard from './ImportContactsWizard'
import { UploadStatusText } from './UploadStatusText'
import { useContactUploads } from './importContactsApi'
import {
  formatUploadDate,
  getImportContactsCopy,
  uploadDetailPath,
} from './importContactsCopy'

const capitalize = (text: string): string =>
  text.charAt(0).toUpperCase() + text.slice(1)

export const UploadHistory = ({ isWin }: { isWin: boolean }) => {
  const COPY = getImportContactsCopy(isWin)
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
      icon={<UploadIcon />}
    >
      {COPY.importContacts}
    </Button>
  )

  return (
    <DashboardLayout
      pathname="/dashboard/contacts"
      showAlert={false}
      navHeader={{ label: COPY.history.title }}
    >
      {/* Voter Data's full-bleed white top bar (the negative margins cancel
          the layout wrapper's padding): the way back on the left, the page's
          one action on the right. */}
      <div className="-mx-2 -mt-2 flex shrink-0 items-center justify-between gap-4 border-b border-border bg-background px-4 py-3 md:-mx-4 md:-mt-4 md:px-6">
        <Button asChild variant="ghost">
          <Link
            href="/dashboard/contacts"
            aria-label={COPY.history.backToContacts}
          >
            <ArrowLeftIcon className="size-4" aria-hidden />
            {COPY.back}
          </Link>
        </Button>
        {importButton}
      </div>
      <div className="mx-auto mt-8 flex w-full max-w-[880px] flex-col gap-6 px-2 pb-32 md:px-0">
        <p className="text-sm text-muted-foreground">{COPY.history.caption}</p>
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
          <>
            {/* Desktop table; a phone gets cards below, like the outreach
              history. */}
            <Card className="hidden overflow-hidden p-0 lg:block">
              {/* The outreach history's table metrics: muted header labels,
                  44px one-line rows, 16px first/last padding. */}
              <Table className="w-full [&_th]:text-muted-foreground [&_td]:h-11 [&_th:first-child]:!pl-4 [&_td:first-child]:!pl-4 [&_th:last-child]:!pr-4 [&_td:last-child]:!pr-4">
                <TableHeader>
                  <TableRow>
                    <TableHead className="whitespace-nowrap">
                      {COPY.history.dateColumn}
                    </TableHead>
                    <TableHead className="w-full">
                      {COPY.history.nameColumn}
                    </TableHead>
                    <TableHead className="whitespace-nowrap">
                      {COPY.history.fileColumn}
                    </TableHead>
                    <TableHead className="whitespace-nowrap">
                      {COPY.history.importedByColumn}
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
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {capitalize(formatUploadDate(upload.createdAt))}
                        </TableCell>
                        <TableCell className="max-w-0 font-medium">
                          <span className="block truncate">{upload.name}</span>
                        </TableCell>
                        <TableCell className="max-w-48 text-muted-foreground">
                          <span className="block truncate">
                            {upload.fileName}
                          </span>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {upload.uploadedBy?.name ?? ''}
                        </TableCell>
                        <TableCell className="text-right">
                          <UploadStatusText
                            status={upload.status}
                            isWin={isWin}
                          />
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </Card>
            <div className="space-y-2 lg:hidden">
              {uploads.map((upload) => {
                const open = () => router.push(uploadDetailPath(upload.id))
                return (
                  <Card
                    key={upload.id}
                    role="button"
                    tabIndex={0}
                    onClick={open}
                    onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        open()
                      }
                    }}
                    className="cursor-pointer gap-1.5 p-4"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-xs text-muted-foreground">
                        {capitalize(formatUploadDate(upload.createdAt))}
                      </span>
                      <UploadStatusText status={upload.status} isWin={isWin} />
                    </div>
                    <span className="truncate text-base font-medium text-foreground">
                      {upload.name}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {COPY.history.fileAndUploader(
                        upload.fileName,
                        upload.uploadedBy?.name ?? null,
                      )}
                    </span>
                  </Card>
                )
              })}
            </div>
          </>
        )}
      </div>
      <ImportContactsWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        isWin={isWin}
      />
    </DashboardLayout>
  )
}
