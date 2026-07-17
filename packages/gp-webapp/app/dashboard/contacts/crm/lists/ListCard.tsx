'use client'

import { useState } from 'react'
import Link from 'next/link'
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
  UserIcon,
} from '@styleguide'
import { dateUsHelper } from 'helpers/dateHelper'
import type { SegmentResponse } from '../shared/contacts-types'
import { useContactsTable } from '../ContactsTableProvider'
import { useDuplicateList } from './useDuplicateList'
import { useListRowDetail } from './useListRowDetail'
import RenameListDialog from './RenameListDialog'
import DeleteListDialog from './DeleteListDialog'

interface ListCardProps {
  segment: SegmentResponse
}

// One full-width row in the lists index (ENG-10725 Lovable parity: rows in
// the 560px column, not a card grid). Rename/Duplicate/Delete live behind
// the kebab menu; the dialogs and mutation hooks (RenameListDialog,
// DeleteListDialog, useDuplicateList) stay shared with ListDetailSheet.
// "Details" opens the list-detail sheet via the provider's shallow
// selectList navigation — not a router.push — so the index stays mounted
// underneath.
export default function ListCard({ segment }: ListCardProps) {
  const { selectList } = useContactsTable()
  const { peopleCount, lastOutreach, isLoading, isError } = useListRowDetail(
    segment.id,
  )
  const duplicateMutation = useDuplicateList()
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const isLocked = Boolean(segment.firstUsedForOutreachAt)

  return (
    <Card className="w-full gap-2 rounded-2xl p-4 shadow-xs">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-base font-semibold">
          {segment.name || 'Untitled list'}
        </h3>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="small"
              aria-label="List options"
              className="size-8 p-0"
            >
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

      <p className="text-[13px] text-muted-foreground">
        {isLoading
          ? 'Loading…'
          : isError
            ? 'Outreach history unavailable'
            : lastOutreach?.date
              ? `Last outreach ${dateUsHelper(lastOutreach.date)}`
              : 'No outreach yet'}
      </p>

      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <UserIcon className="size-3.5" aria-hidden />
          {isLoading
            ? '—'
            : isError
              ? 'Unavailable'
              : (peopleCount?.toLocaleString() ?? '—')}
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="small"
            className="h-8 px-3 text-xs text-primary hover:bg-primary/5"
            onClick={() => selectList(segment.id)}
          >
            Details
          </Button>
          <Button size="small" className="h-8 px-3.5 text-xs" asChild>
            <Link href="/dashboard/outreach">Send outreach</Link>
          </Button>
        </div>
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
