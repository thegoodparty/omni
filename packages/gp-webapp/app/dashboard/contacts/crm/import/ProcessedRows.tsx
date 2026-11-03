import { useEffect, useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import type { ContactUpload, ContactUploadRow } from '@goodparty_org/contracts'
import {
  Button,
  Card,
  ChevronRightIcon,
  cn,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@styleguide'
import { clientRequest } from 'gpApi/typed-request'
import { useOrganization } from '@shared/organization-picker'
import PersonInfoSheet from 'app/dashboard/issue-capture/[outreachId]/components/PersonInfoSheet'
import { contactUploadRowsKey } from './importContactsApi'
import { candidateLabel, getImportContactsCopy } from './importContactsCopy'

const PAGE_SIZE = 50
const SEARCH_DEBOUNCE_MS = 300

const rowName = (row: ContactUploadRow): string =>
  [row.firstName, row.lastName].filter(Boolean).join(' ')

export const ProcessedRows = ({
  upload,
  isWin,
  search,
}: {
  upload: ContactUpload
  isWin: boolean
  search: string
}) => {
  const COPY = getImportContactsCopy(isWin)
  const whatWeDid = (row: ContactUploadRow): string =>
    row.outcome === 'matched' ||
    row.outcome === 'new' ||
    row.outcome === 'resolved'
      ? COPY.processed.whatWeDid(
          row.outcome,
          row.isNewPerson,
          row.changedFields,
        )
      : ''
  const orgSlug = useOrganization()?.slug
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [openRow, setOpenRow] = useState<ContactUploadRow | null>(null)

  useEffect(() => {
    const timeout = setTimeout(
      () => setDebouncedSearch(search.trim()),
      SEARCH_DEBOUNCE_MS,
    )
    return () => clearTimeout(timeout)
  }, [search])

  const rowsQuery = useInfiniteQuery({
    queryKey: [
      ...contactUploadRowsKey(orgSlug, upload.id),
      'processed',
      debouncedSearch,
    ],
    queryFn: async ({ pageParam }) =>
      (
        await clientRequest('GET /v1/contact-uploads/:id/rows', {
          id: upload.id,
          outcome: 'processed',
          take: PAGE_SIZE,
          ...(debouncedSearch ? { search: debouncedSearch } : {}),
          ...(pageParam !== undefined ? { cursor: pageParam } : {}),
        })
      ).data,
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  })

  const rows = rowsQuery.data?.pages.flatMap((page) => page.rows) ?? []

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-foreground">
        {COPY.processed.title}
      </h2>

      {/* Desktop table; a phone gets the phone banking list's rows below. */}
      <Card className="hidden overflow-hidden p-0 lg:block">
        <Table className="w-full [&_th]:text-muted-foreground [&_th:first-child]:!pl-4 [&_td:first-child]:!pl-4 [&_th:last-child]:!pr-4 [&_td:last-child]:!pr-4">
          <TableHeader>
            <TableRow>
              <TableHead>{COPY.processed.nameColumn}</TableHead>
              <TableHead>{COPY.processed.emailColumn}</TableHead>
              <TableHead>{COPY.processed.whatWeDidColumn}</TableHead>
              <TableHead className="w-0" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rowsQuery.isPending ? (
              <TableRow>
                <TableCell colSpan={4}>
                  <Skeleton className="h-8 w-full" />
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="!h-24 text-center text-sm text-muted-foreground"
                >
                  {debouncedSearch
                    ? COPY.processed.empty
                    : COPY.processed.noRows}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                const personId = row.personId
                const open = personId ? () => setOpenRow(row) : undefined
                return (
                  <TableRow
                    key={row.id}
                    role={open ? 'button' : undefined}
                    tabIndex={open ? 0 : undefined}
                    className={open ? 'cursor-pointer' : undefined}
                    onClick={open}
                    onKeyDown={
                      open
                        ? (event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              open()
                            }
                          }
                        : undefined
                    }
                  >
                    <TableCell className="font-medium">
                      {rowName(row)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.email ?? ''}
                    </TableCell>
                    <TableCell className="whitespace-normal text-muted-foreground">
                      {whatWeDid(row)}
                    </TableCell>
                    <TableCell className="w-0">
                      {open && (
                        <ChevronRightIcon
                          size={16}
                          className="text-muted-foreground"
                          aria-hidden
                        />
                      )}
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </Card>
      <Card className="gap-0 overflow-hidden p-0 lg:hidden">
        {rowsQuery.isPending ? (
          <div className="p-4">
            <Skeleton className="h-8 w-full" />
          </div>
        ) : rows.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            {debouncedSearch ? COPY.processed.empty : COPY.processed.noRows}
          </p>
        ) : (
          <ol className="divide-y divide-border">
            {rows.map((row) => {
              const personId = row.personId
              return (
                <li key={row.id} className="flex items-center">
                  <div
                    role={personId ? 'button' : undefined}
                    tabIndex={personId ? 0 : undefined}
                    onClick={personId ? () => setOpenRow(row) : undefined}
                    onKeyDown={
                      personId
                        ? (event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              setOpenRow(row)
                            }
                          }
                        : undefined
                    }
                    className={cn(
                      'flex min-w-0 flex-1 items-center gap-3 px-4 py-3.5 text-left',
                      personId &&
                        'cursor-pointer transition-colors hover:bg-muted/50',
                    )}
                  >
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-sm font-medium text-foreground">
                        {rowName(row)}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {whatWeDid(row)}
                      </span>
                    </span>
                    {personId && (
                      <ChevronRightIcon
                        size={16}
                        className="shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                    )}
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </Card>

      {rowsQuery.hasNextPage && (
        <Button
          variant="ghost"
          className="self-start"
          onClick={() => void rowsQuery.fetchNextPage()}
          loading={rowsQuery.isFetchingNextPage}
        >
          {COPY.processed.showMore}
        </Button>
      )}

      {/* The record in a sheet over this page, as the issue capture report
          opens it, so the upload stays where it was. Change match lives in
          the record, next to the details the match is judged by. */}
      <PersonInfoSheet
        personId={openRow?.personId ?? null}
        isServe={!isWin}
        onClose={() => setOpenRow(null)}
        bottomDrawerOnPhone
        uploadRow={
          openRow
            ? {
                row: {
                  rowId: openRow.id,
                  uploadId: upload.id,
                  label: upload.name,
                },
                description: `${candidateLabel(openRow)}. ${COPY.changeMatch.fromUpload(upload.name)}`,
              }
            : undefined
        }
      />
    </section>
  )
}
