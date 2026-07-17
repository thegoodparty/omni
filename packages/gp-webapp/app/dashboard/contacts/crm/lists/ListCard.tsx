'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Button,
  Card,
  CopyIcon,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  LockIcon,
  MoreHorizontalIcon,
  PencilIcon,
  Trash2Icon,
} from '@styleguide'
import { dateUsHelper } from 'helpers/dateHelper'
import type { SegmentResponse } from '../shared/contacts-types'
import { useDuplicateList } from './useDuplicateList'
import { useListRowDetail } from './useListRowDetail'
import RenameListDialog from './RenameListDialog'
import DeleteListDialog from './DeleteListDialog'

interface ListCardProps {
  segment: SegmentResponse
}

// One card in the ENG-10721 lists-index grid — replaces the ListsTable row.
// Rename/Duplicate/Delete now live behind this card's kebab menu instead of
// the list-detail page's "More actions" dropdown; the dialogs and mutation
// hooks themselves (RenameListDialog, DeleteListDialog, useDuplicateList) are
// unchanged and stay shared with ListDetailPage.tsx, which keeps its own
// copies for the same actions when a user is already on the detail page.
export default function ListCard({ segment }: ListCardProps) {
  const router = useRouter()
  const { peopleCount, lastOutreach, isLoading, isError } = useListRowDetail(
    segment.id,
  )
  const duplicateMutation = useDuplicateList()
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const isLocked = Boolean(segment.firstUsedForOutreachAt)

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-base font-semibold">
          {segment.name || 'Untitled list'}
        </h3>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="small" aria-label="List options">
              <MoreHorizontalIcon className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {isLocked ? (
              <DropdownMenuItem
                disabled={duplicateMutation.isPending}
                onClick={() => duplicateMutation.mutate(segment)}
              >
                <LockIcon />
                Duplicate to edit
              </DropdownMenuItem>
            ) : (
              <>
                <DropdownMenuItem onClick={() => setRenameOpen(true)}>
                  <PencilIcon />
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={duplicateMutation.isPending}
                  onClick={() => duplicateMutation.mutate(segment)}
                >
                  <CopyIcon />
                  Duplicate
                </DropdownMenuItem>
              </>
            )}
            {!isLocked && (
              <DropdownMenuItem
                variant="destructive"
                data-testid="list-card-delete-trigger"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2Icon />
                Delete
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <p className="text-sm text-muted-foreground">
        {isLoading
          ? 'Loading…'
          : isError
            ? 'Outreach history unavailable'
            : lastOutreach?.date
              ? `Last outreach ${dateUsHelper(lastOutreach.date)}`
              : 'No outreach yet'}
      </p>

      <p className="text-2xl font-semibold">
        {isLoading
          ? '—'
          : isError
            ? 'Unavailable'
            : (peopleCount?.toLocaleString() ?? '—')}
      </p>

      <div className="mt-2 flex items-center gap-2">
        <Button
          variant="outline"
          className="flex-1"
          onClick={() => router.push(`/dashboard/contacts/lists/${segment.id}`)}
        >
          Details
        </Button>
        <Button variant="outline" className="flex-1" asChild>
          <Link href="/dashboard/outreach">Send outreach</Link>
        </Button>
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
    </Card>
  )
}
