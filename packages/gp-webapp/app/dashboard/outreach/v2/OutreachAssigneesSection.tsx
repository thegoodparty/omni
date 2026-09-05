'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { OutreachAssignee, TeamMember } from 'gpApi/api-endpoints'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  Card,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Eyebrow,
  IconButton,
  Skeleton,
} from '@styleguide'
import {
  MoreHorizontalIcon,
  Trash2Icon,
  UserPlusIcon,
} from '@styleguide/components/ui/icons'
import { clientRequest } from 'gpApi/typed-request'
import { useOrganization } from '@shared/organization-picker'
import { useTeamAccountsFlag } from '@shared/experiments/teamAccountsFlag'
import { useSnackbar } from 'helpers/useSnackbar'
import { ROLE_LABELS, teamQueryKey } from 'app/dashboard/team/team.util'
import InviteMemberDialog from 'app/dashboard/team/components/InviteMemberDialog'
import { volunteerAssignmentsQueryKey } from 'app/volunteer/components/AssignmentsPage'
import { OutreachAssignModal, initialsFor } from './OutreachAssignModal'

const outreachAssigneesQueryKey = (outreachId: number) => [
  'outreach-assignees',
  outreachId,
]

interface OutreachAssigneesSectionProps {
  outreachId: number
  // The outreach/list name, for the assign modal's title. The drawer holds
  // the row this section only receives an id for, so it threads the name in
  // — absent (a row with no name/title) falls back to generic copy rather
  // than rendering "Assign to undefined".
  outreachName?: string
}

// Manager+ assign/unassign for a self-run list (ENG-11056; the "Assign to"
// modal is ENG-11059's design correction — every org member is assignable,
// owner included, not just volunteers), rendered inside the details drawer
// for nativePhoneBanking/nativeDoorKnocking rows. Gated on win-team-accounts
// (trackExposure: false — the drawer read isn't the flag's own treatment
// surface) and returns null off. Volunteers never reach this drawer at all,
// so there is no second, role-based gate here beyond the flag.
export const OutreachAssigneesSection = ({
  outreachId,
  outreachName,
}: OutreachAssigneesSectionProps) => {
  const { ready: flagReady, enabled: flagEnabled } = useTeamAccountsFlag(false)
  const organization = useOrganization()
  const orgSlug = organization?.slug
  const queryClient = useQueryClient()
  const { successSnackbar, errorSnackbar } = useSnackbar()

  const [assignOpen, setAssignOpen] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<OutreachAssignee | null>(
    null,
  )

  const assigneesQuery = useQuery({
    queryKey: outreachAssigneesQueryKey(outreachId),
    queryFn: () =>
      clientRequest('GET /v1/outreach/:id/assignments', {
        id: String(outreachId),
      }).then((res) => res.data.assignees),
    enabled: flagEnabled,
  })

  // Reads the same cache key TeamPage does — sharing it means a candidate who
  // just opened the team page hits no second request here, and it's the same
  // endpoint ENG-11040's Clerk-paging 502 bursts can hit, so this section
  // needs the same retry affordance TeamPage gets rather than a blank picker.
  const teamQuery = useQuery({
    queryKey: teamQueryKey(orgSlug),
    queryFn: () =>
      clientRequest('GET /v1/organizations/team', {}).then((res) => res.data),
    enabled: flagEnabled && !!orgSlug,
  })

  const invalidateAll = () =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: outreachAssigneesQueryKey(outreachId),
      }),
      queryClient.invalidateQueries({ queryKey: teamQueryKey(orgSlug) }),
      queryClient.invalidateQueries({
        queryKey: volunteerAssignmentsQueryKey(orgSlug),
      }),
    ])

  const assignMutation = useMutation({
    mutationFn: (assigneeUserId: number) =>
      clientRequest('POST /v1/outreach/:id/assignments', {
        id: String(outreachId),
        assigneeUserId,
      }),
    onSuccess: async () => {
      await invalidateAll()
      successSnackbar('Assigned')
    },
    onError: () =>
      errorSnackbar("Couldn't assign this person. Please try again."),
  })

  const removeMutation = useMutation({
    mutationFn: (userId: number) =>
      clientRequest('DELETE /v1/outreach/:id/assignments/:userId', {
        id: String(outreachId),
        userId: String(userId),
      }),
    onSuccess: async () => {
      setRemoveTarget(null)
      await invalidateAll()
      successSnackbar('Removed')
    },
    onError: () =>
      errorSnackbar("Couldn't remove this assignee. Please try again."),
  })

  if (!flagReady || !flagEnabled) return null

  const assignees = assigneesQuery.data ?? []
  const assignedUserIds = new Set(assignees.map((a) => a.userId))
  const members: TeamMember[] = teamQuery.data?.members ?? []
  // Only this outreach's own list-scoped volunteer invites (ENG-11049) — a
  // campaignAdmin invite (or a volunteer invite scoped to a different list)
  // has no business showing up here.
  const pendingInvites = (teamQuery.data?.pendingInvites ?? []).filter(
    (invite) => invite.outreachId === outreachId,
  )
  const hasRows = assignees.length > 0 || pendingInvites.length > 0

  return (
    <>
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <Eyebrow>
            <UserPlusIcon />
            Assigned to
          </Eyebrow>
          <Button
            variant="link"
            className="h-auto p-0"
            onClick={() => setAssignOpen(true)}
          >
            Assign someone
          </Button>
        </div>

        {assigneesQuery.isPending ? (
          <Skeleton className="h-14 w-full" />
        ) : assigneesQuery.isError ? (
          <div className="space-y-1">
            <p className="m-0 text-sm text-muted-foreground">
              Couldn&apos;t load assignees.
            </p>
            <Button
              variant="link"
              className="h-auto p-0"
              onClick={() => assigneesQuery.refetch()}
            >
              Try again
            </Button>
          </div>
        ) : !hasRows ? (
          <p className="m-0 text-sm text-muted-foreground">
            No one is assigned yet.
          </p>
        ) : (
          <div className="space-y-2">
            {assignees.map((assignee) => {
              const member = members.find((m) => m.userId === assignee.userId)
              const displayName =
                assignee.name ?? member?.email ?? `Member #${assignee.userId}`
              return (
                <Card
                  key={assignee.userId}
                  className="flex flex-row items-center gap-3 p-3"
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
                        {ROLE_LABELS[assignee.role] ?? assignee.role}
                      </Badge>
                    </div>
                    {member?.email && (
                      <p className="m-0 truncate text-xs text-muted-foreground">
                        {member.email}
                      </p>
                    )}
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <IconButton
                        variant="ghost"
                        size="small"
                        aria-label={`Manage ${displayName}`}
                      >
                        <MoreHorizontalIcon />
                      </IconButton>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => setRemoveTarget(assignee)}
                      >
                        <Trash2Icon />
                        Remove
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </Card>
              )
            })}
            {pendingInvites.map((invite) => (
              <Card
                key={invite.id}
                className="flex flex-row items-center justify-between gap-3 p-3"
              >
                <div className="min-w-0">
                  <p className="m-0 truncate text-sm font-medium text-foreground">
                    {invite.name}
                  </p>
                  <p className="m-0 text-xs text-muted-foreground">
                    Volunteer · Pending invite
                  </p>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      <OutreachAssignModal
        open={assignOpen}
        onOpenChange={setAssignOpen}
        outreachName={outreachName}
        members={members}
        assignedUserIds={assignedUserIds}
        teamQueryPending={teamQuery.isPending}
        teamQueryError={teamQuery.isError}
        onRetryTeamQuery={() => teamQuery.refetch()}
        assignMutation={assignMutation}
        removeMutation={removeMutation}
        onInviteVolunteer={() => {
          setAssignOpen(false)
          setInviteOpen(true)
        }}
      />

      <InviteMemberDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        role="volunteer"
        outreachId={outreachId}
        onInvited={async () => {
          setInviteOpen(false)
          await invalidateAll()
        }}
      />

      <AlertDialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this assignee?</AlertDialogTitle>
            <AlertDialogDescription>
              {removeTarget?.name ?? 'This person'} will lose access to this
              list.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={removeMutation.isPending}
              onClick={() =>
                removeTarget && removeMutation.mutate(removeTarget.userId)
              }
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
