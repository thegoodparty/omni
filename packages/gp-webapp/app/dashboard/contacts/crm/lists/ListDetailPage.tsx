'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowLeftIcon,
  Button,
  Card,
  CopyIcon,
  DownloadIcon,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HistoryIcon,
  LockIcon,
  MoreHorizontalIcon,
  PencilIcon,
  Trash2Icon,
  UsersRoundIcon,
} from '@styleguide'
import { clientRequest } from 'gpApi/typed-request'
import { useOrganization } from '@shared/organization-picker'
import { useCampaign } from '@shared/hooks/useCampaign'
import { useElectedOffice } from '@shared/hooks/useElectedOffice'
import { useWinVoterContext } from '../../../shared/useWinVoterContext'
import { getContactsLabels } from '../../../shared/contactsLabels'
import DashboardLayout from '../../../shared/DashboardLayout'
import { dateUsHelper } from 'helpers/dateHelper'
import { findCustomSegment } from '../shared/segments.util'
import { useContactsDownload } from '../shared/useContactsDownload'
import type { SegmentResponse } from '../shared/contacts-types'
import {
  OUTREACH_CHANNEL_ICONS,
  OUTREACH_CHANNEL_LABELS,
} from '../shared/outreachChannelLabels'
import { InfoSection } from '../person/InfoSection'
import ListFilterSummary from './ListFilterSummary'
import ReachabilityGrid from './ReachabilityGrid'
import RenameListDialog from './RenameListDialog'
import DeleteListDialog from './DeleteListDialog'
import { useDuplicateList } from './useDuplicateList'

interface ListDetailPageProps {
  listId: string
}

export default function ListDetailPage({ listId }: ListDetailPageProps) {
  const orgSlug = useOrganization()?.slug
  const [campaign] = useCampaign()
  const { data: electedOffice } = useElectedOffice()
  const { isWin: isWinContext } = useWinVoterContext()
  const isElectedOfficial = Boolean(electedOffice)
  const canUseProFeatures = Boolean(campaign?.isPro) || isElectedOfficial
  const labels = getContactsLabels(isWinContext)

  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const segmentsQuery = useQuery({
    queryKey: ['custom-segments', orgSlug],
    queryFn: () =>
      clientRequest('GET /v1/voters/voter-file/filters', {}).then(
        (res) => res.data,
      ),
  })

  const segmentIdNumber = Number(listId)

  // Numeric id in the key, not the raw string `listId` param — must match
  // useListRowDetail's key structurally (same order, same types) or the
  // lists-table row's warm cache is invisible to this page (and vice versa),
  // and every navigation from a row refetches instead of reading the cache.
  const detailQuery = useQuery({
    queryKey: ['list-detail', orgSlug, segmentIdNumber],
    queryFn: () =>
      clientRequest('GET /v1/contacts/list-detail', {
        segment: segmentIdNumber,
      }).then((res) => res.data),
    enabled: Number.isFinite(segmentIdNumber),
  })

  // A non-pro user reaching this URL directly (rather than through the gated
  // "Create new list" entry point) has no upsell modal wired here — the
  // download button itself communicates the lock via LockIcon, mirroring
  // Download.tsx's existing icon-only affordance. onProGated omitted (no-op).
  const { download, isPreparing } = useContactsDownload({
    canUseProFeatures,
  })

  // findCustomSegment's own Segment type is a narrower structural shape
  // (id/name/search only) than SegmentResponse — cast back at the call site,
  // matching the existing precedent in Download.tsx's `filters()`.
  const segment = findCustomSegment(segmentsQuery.data ?? [], listId) as
    | SegmentResponse
    | undefined
  const isLocked = Boolean(segment?.firstUsedForOutreachAt)

  const duplicateMutation = useDuplicateList()

  if (segmentsQuery.isLoading) {
    return (
      <DashboardLayout>
        <p className="p-6 text-sm text-muted-foreground">Loading list…</p>
      </DashboardLayout>
    )
  }

  // A failed fetch must not be conflated with "no such list" — a transient
  // 5xx/network error would otherwise tell the user their list was deleted
  // when it's actually fine (mirrors PersonOverlay.tsx's isErrorPerson state).
  if (segmentsQuery.isError) {
    return (
      <DashboardLayout>
        <div className="flex flex-col gap-4 p-6">
          <Link
            href="/dashboard/contacts"
            className="flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeftIcon className="size-4" aria-hidden />
            Back to lists
          </Link>
          <p className="text-sm text-muted-foreground">
            We couldn&apos;t load this list. Please try again.
          </p>
        </div>
      </DashboardLayout>
    )
  }

  if (!segment) {
    return (
      <DashboardLayout>
        <div className="flex flex-col gap-4 p-6">
          <Link
            href="/dashboard/contacts"
            className="flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeftIcon className="size-4" aria-hidden />
            Back to lists
          </Link>
          <p className="text-sm text-muted-foreground">
            This list couldn&apos;t be found. It may have been deleted.
          </p>
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-4 p-6">
        <Link
          href="/dashboard/contacts"
          className="flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" aria-hidden />
          Back to lists
        </Link>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold">
              {segment.name || 'Untitled list'}
            </h1>
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
                onClick={() => setRenameOpen(true)}
              >
                <PencilIcon className="size-4" />
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() =>
                download(listId, { context: isWinContext ? 'win' : 'serve' })
              }
              loading={isPreparing}
            >
              {!canUseProFeatures ? (
                <LockIcon className="size-4" />
              ) : (
                <DownloadIcon className="size-4" />
              )}
              Download
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" aria-label="More actions">
                  <MoreHorizontalIcon className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => duplicateMutation.mutate(segment)}
                >
                  <CopyIcon />
                  Duplicate
                </DropdownMenuItem>
                {!isLocked && (
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => setDeleteOpen(true)}
                  >
                    <Trash2Icon />
                    Delete
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <ListFilterSummary
          segment={segment}
          isElectedOfficial={isElectedOfficial}
        />

        <InfoSection
          title="List Demographics"
          icon={<UsersRoundIcon size={20} />}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Card className="p-3">
              <p className="text-sm text-muted-foreground">
                {labels.totalLabel}
              </p>
              <p className="mt-1 text-xl font-semibold">
                {detailQuery.isError
                  ? 'Unavailable'
                  : (detailQuery.data?.demographics.people.toLocaleString() ??
                    '—')}
              </p>
            </Card>
            <Card className="p-3">
              <p className="text-sm text-muted-foreground">Average Age</p>
              <p className="mt-1 text-xl font-semibold">
                {detailQuery.isError
                  ? 'Unavailable'
                  : (detailQuery.data?.demographics.avgAge?.toLocaleString() ??
                    '—')}
              </p>
            </Card>
            <Card className="p-3">
              <p className="text-sm text-muted-foreground">Average Income</p>
              <p className="mt-1 text-xl font-semibold">
                {detailQuery.isError
                  ? 'Unavailable'
                  : detailQuery.data?.demographics.avgIncome != null
                    ? `$${Math.round(detailQuery.data.demographics.avgIncome).toLocaleString()}`
                    : '—'}
              </p>
            </Card>
          </div>
        </InfoSection>

        <ReachabilityGrid
          reachability={detailQuery.data?.reachability}
          isError={detailQuery.isError}
        />

        <InfoSection title="Outreach History" icon={<HistoryIcon size={20} />}>
          {detailQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">—</p>
          ) : detailQuery.isError ? (
            <p className="text-sm text-muted-foreground">
              Outreach history is unavailable right now.
            </p>
          ) : detailQuery.data?.outreachHistory.length ? (
            <div className="flex flex-col gap-3">
              {detailQuery.data.outreachHistory.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center justify-between gap-3 border-b border-border pb-3 last:border-none last:pb-0"
                >
                  <div className="flex items-center gap-2">
                    {OUTREACH_CHANNEL_ICONS[entry.outreachType]}
                    <span className="text-sm font-medium">
                      {entry.name ||
                        OUTREACH_CHANNEL_LABELS[entry.outreachType]}
                    </span>
                  </div>
                  <span className="text-sm text-muted-foreground">
                    {entry.date ? dateUsHelper(entry.date) : '—'}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No outreach yet.</p>
          )}
        </InfoSection>
      </div>

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
    </DashboardLayout>
  )
}
