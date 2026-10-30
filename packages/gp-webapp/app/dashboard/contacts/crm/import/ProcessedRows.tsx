import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useInfiniteQuery } from '@tanstack/react-query'
import type { ContactUpload, ContactUploadRow } from '@goodparty_org/contracts'
import {
  Button,
  Card,
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
import { ChangeMatchDialog } from './ChangeMatchDialog'
import { contactUploadRowsKey } from './importContactsApi'
import { candidateLabel, getImportContactsCopy } from './importContactsCopy'

const PAGE_SIZE = 50
const SEARCH_DEBOUNCE_MS = 300

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
  const [changing, setChanging] = useState<ContactUploadRow | null>(null)

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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold text-foreground">
          {COPY.processed.title}
        </h2>
        <div className="w-full sm:w-72">
          <Input
            aria-label={COPY.processed.searchLabel}
            icon={<SearchIcon />}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={COPY.processed.searchPlaceholder}
          />
        </div>
      </div>

      <Card className="overflow-hidden p-0">
        <Table className="w-full [&_th]:text-muted-foreground [&_th:first-child]:!pl-4 [&_td:first-child]:!pl-4 [&_th:last-child]:!pr-4 [&_td:last-child]:!pr-4">
          <TableHeader>
            <TableRow>
              <TableHead>{COPY.processed.nameColumn}</TableHead>
              <TableHead>{COPY.processed.emailColumn}</TableHead>
              <TableHead>{COPY.processed.whatWeDidColumn}</TableHead>
              <TableHead>
                <span className="sr-only">{COPY.processed.changeMatch}</span>
              </TableHead>
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
              rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">
                    {row.personId ? (
                      <Link
                        href={`/dashboard/contacts/${encodeURIComponent(row.personId)}`}
                        className="text-link underline underline-offset-4"
                      >
                        {rowName(row)}
                      </Link>
                    ) : (
                      rowName(row)
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.email ?? ''}
                  </TableCell>
                  <TableCell className="whitespace-normal text-muted-foreground">
                    {whatWeDid(row)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="link"
                      size="small"
                      className="h-auto px-0"
                      onClick={() => setChanging(row)}
                    >
                      {COPY.processed.changeMatch}
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
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

      <ChangeMatchDialog
        open={changing !== null}
        onOpenChange={(open) => {
          if (!open) setChanging(null)
        }}
        rows={
          changing
            ? [{ rowId: changing.id, uploadId: upload.id, label: upload.name }]
            : []
        }
        description={
          changing
            ? `${candidateLabel(changing)}. ${COPY.changeMatch.fromUpload(upload.name)}`
            : undefined
        }
        currentPersonId={changing?.personId ?? null}
        currentPersonName={changing ? rowName(changing) : ''}
        candidates={changing?.candidates ?? []}
        isWin={isWin}
      />
    </section>
  )
}
