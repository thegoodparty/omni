'use client'

import { useEffect, useState } from 'react'
import type { TeamMember } from 'gpApi/api-endpoints'
import {
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
  Skeleton,
  ToggleGroup,
  ToggleGroupItem,
} from '@styleguide'
import {
  CheckIcon,
  MailIcon,
  SearchIcon,
} from '@styleguide/components/ui/icons'
import { cn } from '@styleguide/lib/utils'
import { ROLE_LABELS, formatName } from 'app/dashboard/team/team.util'

export const initialsFor = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || '?'

type RoleFilter = 'all' | 'owner' | 'campaignAdmin' | 'volunteer'

// ROLE_LABELS is a Record<string, string> (team.util.ts keeps it that wide so
// an unmapped wire role never renders raw elsewhere) — noUncheckedIndexedAccess
// reads every access through it as possibly-undefined, so these fallbacks
// exist only to satisfy that; the three keys below are always present.
const ROLE_FILTERS: { value: RoleFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'owner', label: ROLE_LABELS.owner ?? 'Owner' },
  {
    value: 'campaignAdmin',
    label: ROLE_LABELS.campaignAdmin ?? 'Campaign Manager',
  },
  { value: 'volunteer', label: ROLE_LABELS.volunteer ?? 'Volunteer' },
]

interface OutreachAssignModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  outreachName?: string
  members: TeamMember[]
  assignedUserIds: Set<number>
  // userIds with an assign/unassign call currently in flight — owned by the
  // section (which owns both useMutation instances behind onToggleAssignment)
  // rather than derived from either mutation's own isPending/variables here.
  // Those two fields reflect only the MOST RECENT mutate() call: clicking
  // row A then, before A's request resolves, clicking row B recomputes A's
  // pendingForThis to false off B's variables and re-enables A's row, so a
  // second click on A while its first request is still in flight fires a
  // duplicate concurrent POST/DELETE for the same user.
  pendingUserIds: Set<number>
  onToggleAssignment: (userId: number, currentlyAssigned: boolean) => void
  teamQueryPending: boolean
  teamQueryError: boolean
  onRetryTeamQuery: () => void
  onInviteVolunteer: () => void
}

// The "Assign to" modal (ENG-11059): a searchable, role-filterable roster of
// every org member (owner included — the popover this replaced excluded the
// owner, which the ticket calls a design correction, not a permissions
// change). Clicking a row toggles assign/unassign directly against the
// existing endpoints; there's no confirm here, unlike the section's Remove,
// because assigning is reversible with one more click on the same row.
export const OutreachAssignModal = ({
  open,
  onOpenChange,
  outreachName,
  members,
  assignedUserIds,
  pendingUserIds,
  onToggleAssignment,
  teamQueryPending,
  teamQueryError,
  onRetryTeamQuery,
  onInviteVolunteer,
}: OutreachAssignModalProps): React.JSX.Element => {
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all')

  useEffect(() => {
    if (open) {
      setSearch('')
      setRoleFilter('all')
    }
  }, [open])

  const query = search.trim().toLowerCase()
  const filteredMembers = members.filter((member) => {
    if (roleFilter !== 'all' && member.role !== roleFilter) return false
    if (!query) return true
    const name = formatName(member.name, member.email).toLowerCase()
    return name.includes(query) || member.email.toLowerCase().includes(query)
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-4">
        <DialogHeader>
          <DialogTitle>Assign to {outreachName || 'this list'}</DialogTitle>
        </DialogHeader>

        <Input
          icon={<SearchIcon />}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by name, email, or phone"
        />

        <ToggleGroup
          type="single"
          variant="outline"
          value={roleFilter}
          onValueChange={(value) => {
            if (value) setRoleFilter(value as RoleFilter)
          }}
        >
          {ROLE_FILTERS.map((filter) => (
            <ToggleGroupItem key={filter.value} value={filter.value}>
              {filter.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        <div className="flex-1 space-y-2 overflow-y-auto">
          {teamQueryError ? (
            <div className="space-y-1 p-3">
              <p className="m-0 text-sm text-muted-foreground">
                Couldn&apos;t load your team.
              </p>
              <Button
                variant="link"
                className="h-auto p-0"
                onClick={onRetryTeamQuery}
              >
                Try again
              </Button>
            </div>
          ) : teamQueryPending ? (
            <>
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </>
          ) : filteredMembers.length === 0 ? (
            <p className="m-0 p-3 text-sm text-muted-foreground">
              No matching team members.
            </p>
          ) : (
            filteredMembers.map((member) => {
              const assigned = assignedUserIds.has(member.userId)
              const pendingForThis = pendingUserIds.has(member.userId)
              const displayName = formatName(member.name, member.email)
              return (
                <button
                  key={member.userId}
                  type="button"
                  disabled={pendingForThis}
                  onClick={() => onToggleAssignment(member.userId, assigned)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors disabled:opacity-50',
                    assigned
                      ? 'border-tertiary-dark bg-tertiary-dark/5'
                      : 'border-transparent hover:bg-muted',
                  )}
                >
                  <Avatar size="small">
                    <AvatarFallback>{initialsFor(displayName)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">
                        {displayName}
                      </span>
                      <Badge variant="soft" shape="pill">
                        {ROLE_LABELS[member.role] ?? member.role}
                      </Badge>
                    </div>
                    <p className="m-0 truncate text-xs text-muted-foreground">
                      {member.email}
                    </p>
                  </div>
                  {assigned && (
                    <CheckIcon className="size-4 shrink-0 text-tertiary-dark" />
                  )}
                </button>
              )
            })
          )}
        </div>

        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-lg border border-dashed border-base-border p-3 text-left transition-colors hover:bg-muted"
          onClick={onInviteVolunteer}
        >
          <MailIcon className="size-4 text-primary" />
          <span className="font-medium text-primary">Invite a volunteer</span>
        </button>
      </DialogContent>
    </Dialog>
  )
}
