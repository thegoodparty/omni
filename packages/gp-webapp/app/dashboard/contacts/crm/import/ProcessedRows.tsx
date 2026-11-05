import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import type { ContactUpload, ContactUploadRow } from '@goodparty_org/contracts'
import {
  Button,
  Card,
  ChevronRightIcon,
  cn,
  FilterPill,
  FilterPillGroup,
  Input,
  SearchIcon,
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
import { PersonCardSheet } from '../person/PersonOverlay'
import { contactUploadRowsKey } from './importContactsApi'
import {
  UPLOAD_ROW_PARAM,
  candidateLabel,
  getImportContactsCopy,
} from './importContactsCopy'

const PAGE_SIZE = 50
const SEARCH_DEBOUNCE_MS = 300

type VoterFileFilter = 'all' | 'inFile' | 'notInFile'

const rowName = (row: ContactUploadRow): string =>
  [row.firstName, row.lastName].filter(Boolean).join(' ')

export const ProcessedRows = ({
  upload,
  isWin,
}: {
  upload: ContactUpload
  isWin: boolean
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
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [openRow, setOpenRow] = useState<ContactUploadRow | null>(null)
  const [voterFileFilter, setVoterFileFilter] = useState<VoterFileFilter>('all')

  // `?row=` (uploadRowPath, the record's Came from links) opens that row's
  // person. A row since changed or undone is not processed, so none opens.
  // Keyed outside ['contact-uploads'] so Change match's invalidation does not
  // refetch it and reopen the row on the person it now points at.
  const searchParams = useSearchParams()
  const linkedRowId = searchParams?.get(UPLOAD_ROW_PARAM) ?? null
  const linkedRowQuery = useQuery({
    queryKey: ['contact-upload-linked-row', orgSlug, upload.id, linkedRowId],
    queryFn: async () =>
      (
        await clientRequest('GET /v1/contact-uploads/:id/rows', {
          id: upload.id,
          outcome: 'processed',
          rowId: linkedRowId ?? undefined,
          take: 1,
        })
      ).data,
    enabled: linkedRowId !== null,
  })
  const linkedRow = linkedRowQuery.data?.rows[0]
  useEffect(() => {
    if (linkedRow?.personId) setOpenRow(linkedRow)
  }, [linkedRow])
  const closeRow = () => {
    setOpenRow(null)
    if (linkedRowId === null) return
    const params = new URLSearchParams(searchParams?.toString() || '')
    params.delete(UPLOAD_ROW_PARAM)
    const query = params.toString()
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${query ? `?${query}` : ''}`,
    )
  }

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
      voterFileFilter,
      debouncedSearch,
    ],
    queryFn: async ({ pageParam }) =>
      (
        await clientRequest('GET /v1/contact-uploads/:id/rows', {
          id: upload.id,
          outcome: 'processed',
          take: PAGE_SIZE,
          ...(debouncedSearch ? { search: debouncedSearch } : {}),
          ...(voterFileFilter === 'all'
            ? {}
            : {
                inVoterFile:
                  voterFileFilter === 'inFile'
                    ? ('true' as const)
                    : ('false' as const),
              }),
          ...(pageParam !== undefined ? { cursor: pageParam } : {}),
        })
      ).data,
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  })

  const rows = rowsQuery.data?.pages.flatMap((page) => page.rows) ?? []
  const emptyText = debouncedSearch
    ? COPY.processed.empty
    : voterFileFilter !== 'all'
      ? COPY.processed.filteredEmpty
      : COPY.processed.noRows

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-foreground">
        {COPY.processed.title}
      </h2>
      <Input
        aria-label={COPY.processed.searchLabel}
        icon={<SearchIcon />}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder={COPY.processed.searchPlaceholder}
      />

      <FilterPillGroup
        aria-label={COPY.processed.filterLabel}
        value={voterFileFilter}
        onValueChange={(value) => {
          // Radix single-toggle emits '' on re-select of the active pill;
          // keep the current filter so one is always selected.
          if (value) setVoterFileFilter(value as VoterFileFilter)
        }}
      >
        <FilterPill value="all">{COPY.processed.filterAll}</FilterPill>
        <FilterPill value="inFile">{COPY.processed.filterInFile}</FilterPill>
        <FilterPill value="notInFile">
          {COPY.processed.filterNotInFile}
        </FilterPill>
      </FilterPillGroup>

      {/* Desktop table; a phone gets the phone banking list's rows below. */}
      <Card className="hidden overflow-hidden p-0 lg:block">
        <Table className="w-full [&_th]:text-muted-foreground [&_td]:h-11 [&_th:first-child]:!pl-4 [&_td:first-child]:!pl-4 [&_th:last-child]:!pr-4 [&_td:last-child]:!pr-4">
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
                  {emptyText}
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
            {emptyText}
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
                      <span className="truncate text-base font-medium text-foreground">
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

      {/* Voter Data's own record, over this page, so the upload stays where
          it was. Change match lives in the record, next to the details the
          match is judged by. */}
      <PersonCardSheet
        personId={openRow?.personId ?? null}
        onClose={closeRow}
        uploadRow={
          openRow
            ? {
                row: {
                  rowId: openRow.id,
                  uploadId: upload.id,
                },
                description: `${candidateLabel(openRow)}. ${COPY.changeMatch.fromUpload(upload.name)}`,
                candidates: openRow.candidates,
                // The row now points at someone else, so the record shown
                // is no longer this row's person.
                onChanged: closeRow,
              }
            : undefined
        }
      />
    </section>
  )
}
