'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import {
  Button,
  CalendarIcon,
  ClockIcon,
  CopyIcon,
  DollarSignIcon,
  DownloadIcon,
  DrawerTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  LockIcon,
  MessageSquareIcon,
  MoreHorizontalIcon,
  PencilIcon,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Trash2Icon,
  UsersRoundIcon,
} from '@styleguide'
import { clientRequest } from 'gpApi/typed-request'
import { useOrganization } from '@shared/organization-picker'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { dateUsHelper } from 'helpers/dateHelper'
import { getContactsLabels } from '../../../shared/contactsLabels'
import { findCustomSegment } from '../shared/segments.util'
import { useContactsDownload } from '../shared/useContactsDownload'
import { useContactsTable } from '../ContactsTableProvider'
import type { SegmentResponse } from '../shared/contacts-types'
import { OUTREACH_CHANNEL_LABELS } from '../shared/outreachChannelLabels'
import CrmSheet from '../shared/CrmSheet'
import ListFilterSummary from './ListFilterSummary'
import ReachabilityGrid from './ReachabilityGrid'
import RenameListDialog from './RenameListDialog'
import DeleteListDialog from './DeleteListDialog'
import { useDuplicateList } from './useDuplicateList'
import { SectionLabel, StatTile } from './ListDetailSection'

interface ListDetailSheetProps {
  listId: string | null
  onClose: () => void
}

// The list-detail surface (ENG-10725 Lovable parity): the same top sheet the
// wizard uses, opened over the lists index — no route change; the
// /dashboard/contacts/lists/<id> URL stays deep-linkable through the
// provider's shallow selectList + the catch-all route. Replaces the
// standalone ListDetailPage. Sections: filter-summary sentence, bordered
// icon demographics tiles, reachable-by-channel tiles, and an
// outreach-history table, with Download + Send outreach pinned to the sheet
// footer.
export default function ListDetailSheet({
  listId,
  onClose,
}: ListDetailSheetProps) {
  const orgSlug = useOrganization()?.slug
  const {
    canUseProFeatures,
    isElectedOfficial,
    isWinContext,
    isWinContextReady,
  } = useContactsTable()

  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  // Fetched directly (not via the provider's customSegments) for its
  // loading/error states: a deep link can open the sheet before the
  // segments list resolves, and "loading" must not read as "deleted".
  // React Query dedupes with the provider on the shared key.
  const segmentsQuery = useQuery({
    queryKey: ['custom-segments', orgSlug],
    queryFn: () =>
      clientRequest('GET /v1/voters/voter-file/filters', {}).then(
        (res) => res.data,
      ),
  })

  const segmentIdNumber = Number(listId)

  // Numeric id in the key, not the raw string `listId` — must match
  // useListRowDetail's key structurally (same order, same types) or the
  // lists-row's warm cache is invisible to this sheet (and vice versa).
  const detailQuery = useQuery({
    queryKey: ['list-detail', orgSlug, segmentIdNumber],
    queryFn: () =>
      clientRequest('GET /v1/contacts/list-detail', {
        segment: segmentIdNumber,
      }).then((res) => res.data),
    enabled: listId !== null && Number.isFinite(segmentIdNumber),
  })

  // A non-pro user reaching this URL directly has no upsell modal wired
  // here — the download button communicates the lock via LockIcon,
  // mirroring Download.tsx's existing icon-only affordance.
  const { download, isPreparing } = useContactsDownload({
    canUseProFeatures,
  })

  const segment = listId
    ? (findCustomSegment(segmentsQuery.data ?? [], listId) as
        | SegmentResponse
        | undefined)
    : undefined
  const isLocked = Boolean(segment?.firstUsedForOutreachAt)

  const duplicateMutation = useDuplicateList()

  const labels = getContactsLabels(isWinContext)

  const demographics = detailQuery.data?.demographics
  const lastOutreach = detailQuery.data?.outreachHistory[0]
  const statValue = (formatted: string | null | undefined): string =>
    detailQuery.isError ? 'Unavailable' : (formatted ?? '—')

  const handleDownload = () => {
    if (!listId) return
    download(listId, { context: isWinContext ? 'win' : 'serve' }, () => {
      // ENG-10709: fires only from the cookie-confirmed success branch
      // inside useContactsDownload — never on the ambiguous 15s-fallback
      // path or a failed download. Gated on isWinContextReady like the
      // other product-specific events in this surface. Also gated on the
      // demographics count being known — a click that lands before
      // GET /v1/contacts/list-detail resolves must not emit a
      // listSize-less event.
      const listSize = detailQuery.data?.demographics.people
      if (isWinContextReady && listSize !== undefined) {
        trackEvent(
          isWinContext
            ? EVENTS.VoterData.ListExported
            : EVENTS.ConstituentData.ListExported,
          { listSize },
        )
      }
    })
  }

  return (
    <CrmSheet
      open={listId !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      header={
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col gap-0.5">
            <DrawerTitle className="text-base font-semibold">
              {segment ? segment.name || 'Untitled list' : 'List details'}
            </DrawerTitle>
            <p className="text-sm font-normal text-muted-foreground">
              List details
            </p>
          </div>
          {segment && (
            <div className="flex items-center gap-1">
              {isLocked ? (
                <Button
                  variant="ghost"
                  size="small"
                  className="gap-1.5 text-muted-foreground"
                  onClick={() => duplicateMutation.mutate(segment)}
                  loading={duplicateMutation.isPending}
                >
                  <LockIcon className="size-4" />
                  Duplicate to edit
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="small"
                  aria-label="Rename list"
                  className="size-8 p-0"
                  onClick={() => setRenameOpen(true)}
                >
                  <PencilIcon className="size-4" />
                </Button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="small"
                    aria-label="More actions"
                    className="size-8 p-0"
                  >
                    <MoreHorizontalIcon className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    disabled={duplicateMutation.isPending}
                    onClick={() => duplicateMutation.mutate(segment)}
                  >
                    <CopyIcon />
                    Duplicate
                  </DropdownMenuItem>
                  {!isLocked && (
                    <DropdownMenuItem
                      variant="destructive"
                      data-testid="list-detail-delete-trigger"
                      onClick={() => setDeleteOpen(true)}
                    >
                      <Trash2Icon />
                      Delete
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
      }
      footer={
        segment ? (
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              className="size-11 shrink-0 p-0"
              aria-label="Download list"
              onClick={handleDownload}
              loading={isPreparing}
            >
              {!canUseProFeatures ? (
                <LockIcon className="size-4" />
              ) : (
                <DownloadIcon className="size-4" />
              )}
            </Button>
            <Button className="h-11 flex-1 text-sm" asChild>
              <Link href="/dashboard/outreach">Send outreach</Link>
            </Button>
          </div>
        ) : undefined
      }
    >
      {segmentsQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading list…</p>
      ) : segmentsQuery.isError ? (
        // A failed fetch must not be conflated with "no such list" — a
        // transient 5xx/network error would otherwise tell the user their
        // list was deleted when it's actually fine.
        <p className="text-sm text-muted-foreground">
          We couldn&apos;t load this list. Please try again.
        </p>
      ) : !segment ? (
        <p className="text-sm text-muted-foreground">
          This list couldn&apos;t be found. It may have been deleted.
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          {/* Mode copy waits for the Win/Serve context to settle —
              isWinContext reads false until then, so rendering early would
              flash the Serve noun to a Win user (ENG-10448). */}
          {isWinContextReady && (
            <h2 className="text-base font-semibold">
              {labels.listDetailsTitle}
            </h2>
          )}

          <ListFilterSummary
            segment={segment}
            isElectedOfficial={isElectedOfficial}
          />

          <div className="flex flex-col gap-2">
            <SectionLabel>List demographics</SectionLabel>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <StatTile
                icon={<UsersRoundIcon size={16} className="shrink-0" />}
                label="People"
                value={statValue(demographics?.people.toLocaleString())}
              />
              <StatTile
                icon={<CalendarIcon size={16} className="shrink-0" />}
                label="Avg age"
                value={statValue(
                  demographics?.avgAge != null
                    ? String(Math.round(demographics.avgAge))
                    : demographics
                      ? '—'
                      : undefined,
                )}
              />
              <StatTile
                icon={<DollarSignIcon size={16} className="shrink-0" />}
                label="Avg income"
                value={statValue(
                  demographics?.avgIncome != null
                    ? `$${Math.round(demographics.avgIncome).toLocaleString()}`
                    : demographics
                      ? '—'
                      : undefined,
                )}
              />
              <StatTile
                icon={<ClockIcon size={16} className="shrink-0" />}
                label="Last outreach"
                value={statValue(
                  detailQuery.data
                    ? lastOutreach?.date
                      ? dateUsHelper(lastOutreach.date)
                      : '—'
                    : undefined,
                )}
              />
              <StatTile
                icon={<MessageSquareIcon size={16} className="shrink-0" />}
                label="Last method"
                value={statValue(
                  detailQuery.data
                    ? lastOutreach
                      ? OUTREACH_CHANNEL_LABELS[lastOutreach.outreachType]
                      : '—'
                    : undefined,
                )}
              />
            </dl>
          </div>

          <ReachabilityGrid
            reachability={detailQuery.data?.reachability}
            isError={detailQuery.isError}
          />

          <div className="flex flex-col gap-2">
            <h2 className="text-base font-semibold">Outreach history</h2>
            <p className="text-sm text-muted-foreground">
              Every campaign you&apos;ve sent, most recent first.
            </p>
            {detailQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">—</p>
            ) : detailQuery.isError ? (
              <p className="text-sm text-muted-foreground">
                Outreach history is unavailable right now.
              </p>
            ) : detailQuery.data?.outreachHistory.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Channel</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detailQuery.data.outreachHistory.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="text-muted-foreground">
                        {entry.date ? dateUsHelper(entry.date) : '—'}
                      </TableCell>
                      <TableCell className="font-medium">
                        {entry.name ||
                          OUTREACH_CHANNEL_LABELS[entry.outreachType]}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {OUTREACH_CHANNEL_LABELS[entry.outreachType]}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground">No outreach yet.</p>
            )}
          </div>
        </div>
      )}

      {segment && (
        <>
          <RenameListDialog
            segment={segment}
            open={renameOpen}
            onOpenChange={setRenameOpen}
          />
          <DeleteListDialog
            segment={segment}
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
          />
        </>
      )}
    </CrmSheet>
  )
}
