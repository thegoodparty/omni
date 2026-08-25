'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import {
  Badge,
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
import { ALL_SEGMENTS } from '../shared/constants'
import { findCustomSegment } from '../shared/segments.util'
import { useContactsDownload } from '../shared/useContactsDownload'
import { useContactsTable } from '../ContactsTableProvider'
import type { SegmentResponse } from '../shared/contacts-types'
import { OUTREACH_CHANNEL_NOUNS } from '../shared/outreachChannelLabels'
import CrmSheet from '../shared/CrmSheet'
import ListFilterSummary from './ListFilterSummary'
import ReachabilityGrid from './ReachabilityGrid'
import RenameListDialog from './RenameListDialog'
import DeleteListDialog from './DeleteListDialog'
import DuplicateListDialog from './DuplicateListDialog'
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
// footer. ENG-10778 adds a universe mode (listId === ALL_SEGMENTS, the "All
// voters"/"All constituents" row): demographics + reachability only — no
// segment to key a kebab, filter summary, lock state, or outreach history
// on. ENG-10809 restores the footer's Download button for universe mode too
// (GET /v1/contacts/download resolves an omitted/'all' segment to the whole
// district server-side) — Send outreach stays list-only since the universe
// row's own card already carries that button.
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
    voterDataUnavailable,
  } = useContactsTable()

  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [duplicateOpen, setDuplicateOpen] = useState(false)

  const isUniverse = listId === ALL_SEGMENTS

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
  // lists-row's warm cache is invisible to this sheet (and vice versa). The
  // universe mode has no row-level warm cache to match (ENG-10778's
  // AllContactsCard doesn't prefetch this slower whole-district query), so
  // its key just needs to be stable and distinct from any numeric id.
  const detailQuery = useQuery({
    queryKey: [
      'list-detail',
      orgSlug,
      isUniverse ? ALL_SEGMENTS : segmentIdNumber,
    ],
    queryFn: () =>
      clientRequest(
        'GET /v1/contacts/list-detail',
        isUniverse ? {} : { segment: segmentIdNumber },
      ).then((res) => res.data),
    // getListDetail's own pro check runs before its segment branch, so a non-pro
    // request can only 400 — including the direct-URL path, which has no upsell
    // modal wired here.
    enabled:
      canUseProFeatures &&
      !voterDataUnavailable &&
      listId !== null &&
      (isUniverse || Number.isFinite(segmentIdNumber)),
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

  // ENG-10767: the legacy page fired Segment Viewed from its segment picker;
  // this sheet is the CRM equivalent ("which lists get used"). One fire per
  // sheet open, once the segment resolves (a deep link can open the sheet
  // before the segments fetch lands) and the Win/Serve mode settles; the ref
  // re-arms on close so reopening the same list fires again.
  const firedViewedListIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (listId === null) {
      firedViewedListIdRef.current = null
      return
    }
    if (
      firedViewedListIdRef.current === listId ||
      !segment ||
      !isWinContextReady
    ) {
      return
    }
    firedViewedListIdRef.current = listId
    trackEvent(EVENTS.Contacts.SegmentViewed, {
      segment: segment.name,
      type: 'custom',
      context: isWinContext ? 'win' : 'serve',
    })
  }, [listId, segment, isWinContextReady, isWinContext])

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
          { listSize, surface: 'listDetail' },
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
        isUniverse ? (
          // No list to rename/duplicate/delete — the universe row's header
          // is just its mode-aware title, held to the neutral fallback
          // until isWinContextReady settles (ENG-10448: never flash the
          // wrong noun).
          <DrawerTitle className="text-base font-semibold">
            {isWinContextReady ? labels.allContactsTitle : 'List details'}
          </DrawerTitle>
        ) : (
          <div className="flex items-start justify-between gap-2">
            {/* The prototype's sheet header carries only the list name — the
              body's "Voter/Constituent list details" h2 is the section
              heading. 'List details' remains only as the neutral title for
              the no-segment (loading/missing) states. */}
            <DrawerTitle className="text-base font-semibold">
              {segment ? segment.name || 'Untitled list' : 'List details'}
            </DrawerTitle>
            {segment && (
              <div className="flex items-center gap-1">
                {isLocked ? (
                  <Button
                    variant="ghost"
                    size="small"
                    className="gap-1.5 text-muted-foreground"
                    onClick={() => setDuplicateOpen(true)}
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
                    <DropdownMenuItem onClick={() => setDuplicateOpen(true)}>
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
        )
      }
      footer={
        isUniverse || segment ? (
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
            {/* ENG-10749: Win-only — Serve outreach is deferred and the
                link dead-ends for an eo- org; the readiness gate avoids
                flashing the button at a Serve user while the mode
                resolves. `segment` also excludes universe mode — that
                row's own card carries its own Send outreach button. */}
            {segment && isWinContextReady && isWinContext && (
              <Button className="h-11 flex-1 text-sm" asChild>
                <Link
                  href={`/dashboard/outreach?listId=${segment.id}`}
                  onClick={() =>
                    trackEvent(EVENTS.VoterData.SendOutreachClicked, {
                      listId: segment.id,
                      surface: 'listDetail',
                    })
                  }
                >
                  Send outreach
                </Link>
              </Button>
            )}
          </div>
        ) : undefined
      }
    >
      {!isUniverse && segmentsQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading list…</p>
      ) : !isUniverse && segmentsQuery.isError ? (
        // A failed fetch must not be conflated with "no such list" — a
        // transient 5xx/network error would otherwise tell the user their
        // list was deleted when it's actually fine.
        <p className="text-sm text-muted-foreground">
          We couldn&apos;t load this list. Please try again.
        </p>
      ) : !isUniverse && !segment ? (
        <p className="text-sm text-muted-foreground">
          This list couldn&apos;t be found. It may have been deleted.
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          {/* Mode copy waits for the Win/Serve context to settle —
              isWinContext reads false until then, so rendering early would
              flash the Serve noun to a Win user (ENG-10448). The universe
              row's own mode-aware title already sits in the header above,
              so it skips this second heading entirely (ENG-10778). */}
          {!isUniverse && isWinContextReady && (
            <h2 className="text-base font-semibold">
              {labels.listDetailsTitle}
            </h2>
          )}

          {!isUniverse && segment && (
            <ListFilterSummary
              segment={segment}
              isElectedOfficial={isElectedOfficial}
            />
          )}

          <div className="flex flex-col gap-2">
            <SectionLabel>
              {isUniverse ? 'District demographics' : 'List demographics'}
            </SectionLabel>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <StatTile
                icon={<UsersRoundIcon size={16} className="shrink-0" />}
                label="People"
                value={statValue(
                  demographics
                    ? demographics.people.toLocaleString()
                    : undefined,
                )}
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
              {/* Last outreach/method have no meaning for the universe row —
                  it isn't a saved list, so there's no outreachHistory to key
                  them on (the API always returns [] for this mode). */}
              {!isUniverse && (
                <>
                  <StatTile
                    icon={<ClockIcon size={16} className="shrink-0" />}
                    label="Last outreach"
                    value={statValue(
                      detailQuery.data
                        ? lastOutreach
                          ? dateUsHelper(
                              lastOutreach.date ?? lastOutreach.createdAt,
                            )
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
                          ? (OUTREACH_CHANNEL_NOUNS[
                              lastOutreach.outreachType
                            ] ?? lastOutreach.outreachType)
                          : '—'
                        : undefined,
                    )}
                  />
                </>
              )}
            </dl>
          </div>

          <ReachabilityGrid
            reachability={detailQuery.data?.reachability}
            isLoading={detailQuery.isLoading}
            isError={detailQuery.isError}
          />

          {!isUniverse && (
            <div className="flex flex-col gap-2">
              {/* h3 like the other section labels (valid heading order under
                  the DrawerTitle h2); the prototype styles this one as a
                  sentence-case heading, not an uppercase micro-label. */}
              <h3 className="text-base font-semibold">Outreach history</h3>
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
                    {detailQuery.data.outreachHistory.map((entry) => {
                      // ENG-10776: legacy rows can carry a null `date` (e.g.
                      // a hand-logged draft) — createdAt is always present,
                      // so the row never renders a bare "—" date.
                      const entryDate = entry.date ?? entry.createdAt
                      return (
                        <TableRow key={entry.id}>
                          <TableCell className="text-muted-foreground">
                            {dateUsHelper(entryDate)}
                          </TableCell>
                          <TableCell className="font-medium">
                            {/* Robocall/phone-banking campaigns are created
                              with name null — fall back to a channel + date
                              label, never the activity-feed verb ("Called"). */}
                            {entry.name ||
                              `${OUTREACH_CHANNEL_NOUNS[entry.outreachType] ?? entry.outreachType} — ${dateUsHelper(entryDate)}`}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            <Badge variant="soft" shape="pill">
                              {/* ?? guards the deploy-skew window where the API
                                serves a channel newer than this bundle's
                                map. */}
                              {OUTREACH_CHANNEL_NOUNS[entry.outreachType] ??
                                entry.outreachType}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No outreach yet.
                </p>
              )}
            </div>
          )}
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
          <DuplicateListDialog
            segment={segment}
            open={duplicateOpen}
            onOpenChange={setDuplicateOpen}
          />
        </>
      )}
    </CrmSheet>
  )
}
