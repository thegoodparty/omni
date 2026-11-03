import { useInfiniteQuery, useMutation } from '@tanstack/react-query'
import {
  CONTACT_UPLOAD_FIELDS,
  type ContactUpload,
  type ContactUploadRow,
} from '@goodparty_org/contracts'
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CircleAlertIcon,
  DownloadIcon,
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHandle,
  DrawerHeader,
  DrawerTitle,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@styleguide'
import { useIsMobile } from '@styleguide/hooks/use-mobile'
import { clientRequest } from 'gpApi/typed-request'
import { useOrganization } from '@shared/organization-picker'
import { contactUploadRowsKey } from './importContactsApi'
import { getImportContactsCopy } from './importContactsCopy'

const PAGE_SIZE = 100

// rowIndex counts the file's rows from 0 under the header, which is the
// file's row 1.
const fileRowNumber = (row: ContactUploadRow): number => row.rowIndex + 2

// As gp-api's csvEscape: a cell starting like a formula is forced to text so
// a spreadsheet won't run it, unless it is only digits and phone punctuation.
const INERT_NUMERIC = /^[+-][\d\s()./-]+$/

const csvCell = (value: string): string => {
  const safe =
    /^[=+\-@\t\r]/.test(value) && !INERT_NUMERIC.test(value)
      ? `'${value}`
      : value
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

// The rows an import left out: the ones the user chose to skip, or the ones
// missing a first or last name. They can be downloaded to fix and import
// again.
export const SkippedRows = ({
  upload,
  outcome,
  isWin,
  onClose,
}: {
  upload: ContactUpload
  outcome: 'skipped' | 'invalid'
  isWin: boolean
  onClose: () => void
}) => {
  const COPY = getImportContactsCopy(isWin).skippedRows
  const orgSlug = useOrganization()?.slug
  const isMobile = useIsMobile()
  const title = outcome === 'skipped' ? COPY.skippedTitle : COPY.invalidTitle
  const caption =
    outcome === 'skipped' ? COPY.skippedCaption : COPY.invalidCaption

  const rowsQuery = useInfiniteQuery({
    queryKey: [...contactUploadRowsKey(orgSlug, upload.id), outcome],
    queryFn: async ({ pageParam }) =>
      (
        await clientRequest('GET /v1/contact-uploads/:id/rows', {
          id: upload.id,
          outcome,
          take: PAGE_SIZE,
          ...(pageParam !== undefined ? { cursor: pageParam } : {}),
        })
      ).data,
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  })

  const rows = rowsQuery.data?.pages.flatMap((page) => page.rows) ?? []

  // Every row, not only the ones shown, under the file's own column names,
  // so the import that brings them back finds its columns already matched.
  const download = useMutation({
    mutationFn: async () => {
      const allRows: ContactUploadRow[] = []
      let cursor: number | null | undefined = undefined
      do {
        const page: { rows: ContactUploadRow[]; nextCursor: number | null } = (
          await clientRequest('GET /v1/contact-uploads/:id/rows', {
            id: upload.id,
            outcome,
            take: PAGE_SIZE,
            ...(cursor !== undefined ? { cursor } : {}),
          })
        ).data
        allRows.push(...page.rows)
        cursor = page.nextCursor
      } while (cursor !== null)

      const fields = CONTACT_UPLOAD_FIELDS.filter(
        (field) => upload.columnMapping[field] !== null,
      )
      const lines = [
        [
          COPY.rowColumn,
          ...fields.map((field) => upload.columnMapping[field] ?? ''),
        ],
        ...allRows.map((row) => [
          String(fileRowNumber(row)),
          ...fields.map((field) => row[field] ?? ''),
        ]),
      ].map((line) => line.map(csvCell).join(','))

      const url = URL.createObjectURL(
        new Blob([`${lines.join('\r\n')}\r\n`], { type: 'text/csv' }),
      )
      const link = document.createElement('a')
      link.href = url
      link.download = COPY.fileName(upload.fileName, outcome)
      document.body.appendChild(link)
      link.click()
      setTimeout(() => {
        URL.revokeObjectURL(url)
        document.body.removeChild(link)
      }, 0)
    },
  })

  const name = (row: ContactUploadRow): string =>
    [row.firstName, row.lastName].filter(Boolean).join(' ') || COPY.noName
  const phones = (row: ContactUploadRow): string =>
    [row.cellPhone, row.landline].filter(Boolean).join(', ')
  const address = (row: ContactUploadRow): string =>
    [row.addressLine, row.city, row.zip].filter(Boolean).join(', ')

  const actions = (
    <div className="flex flex-col gap-3">
      <Button
        type="button"
        variant="outline"
        className="w-full lg:w-auto lg:self-start"
        onClick={() => download.mutate()}
        loading={download.isPending}
        disabled={rows.length === 0}
      >
        <DownloadIcon className="size-4" aria-hidden />
        {COPY.download}
      </Button>
      {download.isError && (
        <Alert variant="destructive" icon={<CircleAlertIcon />}>
          <AlertDescription>{COPY.downloadFailed}</AlertDescription>
        </Alert>
      )}
    </div>
  )

  const showMore = rowsQuery.hasNextPage && (
    <Button
      type="button"
      variant="ghost"
      className="self-start"
      onClick={() => void rowsQuery.fetchNextPage()}
      loading={rowsQuery.isFetchingNextPage}
    >
      {COPY.showMore}
    </Button>
  )

  const status = rowsQuery.isError ? (
    <p className="p-6 text-center text-sm text-muted-foreground">
      {COPY.loadFailed}
    </p>
  ) : rowsQuery.isPending ? (
    <div className="p-4">
      <Skeleton className="h-8 w-full" />
    </div>
  ) : null

  if (isMobile) {
    return (
      <Drawer
        open
        onOpenChange={(open) => {
          if (!open) onClose()
        }}
      >
        {/* PersonInfoSheet's phone drawer: phone banking's call panel
            height, handle included. */}
        <DrawerContent className="flex h-[92dvh] flex-col overflow-hidden p-0 data-[vaul-drawer-direction=bottom]:max-h-[92dvh]">
          <DrawerHandle className="mt-3 h-1.5 w-[120px]" />
          <DrawerHeader>
            <DrawerTitle>{title}</DrawerTitle>
            <DrawerDescription>{caption}</DrawerDescription>
          </DrawerHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-6">
            {actions}
            <Card className="gap-0 overflow-hidden p-0">
              {status ?? (
                <ol className="divide-y divide-border">
                  {rows.map((row) => (
                    <li
                      key={row.id}
                      className="flex flex-col gap-0.5 px-4 py-3.5"
                    >
                      <span className="text-xs text-muted-foreground">
                        {COPY.rowNumber(fileRowNumber(row))}
                      </span>
                      <span className="text-sm font-medium text-foreground">
                        {name(row)}
                      </span>
                      {[row.email, phones(row), address(row)]
                        .filter(Boolean)
                        .map((detail) => (
                          <span
                            key={detail}
                            className="text-xs break-words text-muted-foreground"
                          >
                            {detail}
                          </span>
                        ))}
                    </li>
                  ))}
                </ol>
              )}
            </Card>
            {showMore}
          </div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      {/* PersonInfoSheet's shell, wide enough for the table. */}
      <SheetContent className="z-[1301] h-full w-screen overflow-y-auto p-6 sm:w-[90vw] sm:max-w-3xl">
        <div className="flex flex-col gap-2 pr-6">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{caption}</SheetDescription>
        </div>
        {actions}
        <Card className="overflow-hidden p-0">
          {status ?? (
            <Table className="w-full [&_th]:text-muted-foreground [&_td]:h-11 [&_td]:whitespace-normal [&_th:first-child]:!pl-4 [&_td:first-child]:!pl-4 [&_th:last-child]:!pr-4 [&_td:last-child]:!pr-4">
              <TableHeader>
                <TableRow>
                  <TableHead>{COPY.rowColumn}</TableHead>
                  <TableHead>{COPY.nameColumn}</TableHead>
                  <TableHead>{COPY.emailColumn}</TableHead>
                  <TableHead>{COPY.phoneColumn}</TableHead>
                  <TableHead>{COPY.addressColumn}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="text-muted-foreground">
                      {fileRowNumber(row)}
                    </TableCell>
                    <TableCell className="font-medium">{name(row)}</TableCell>
                    <TableCell className="break-all text-muted-foreground">
                      {row.email ?? ''}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {phones(row)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {address(row)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
        {showMore}
      </SheetContent>
    </Sheet>
  )
}
