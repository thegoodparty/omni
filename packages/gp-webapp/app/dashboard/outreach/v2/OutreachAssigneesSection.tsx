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
  Button,
  Card,
  Eyebrow,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Skeleton,
} from '@styleguide'
import { MailIcon, PlusIcon, Trash2Icon } from '@styleguide/components/ui/icons'
import { clientRequest } from 'gpApi/typed-request'
import { useOrganization } from '@shared/organization-picker'
import { useTeamAccountsFlag } from '@shared/experiments/teamAccountsFlag'
import { useSnackbar } from 'helpers/useSnackbar'
import {
  ROLE_LABELS,
  formatName,
  teamQueryKey,
} from 'app/dashboard/team/team.util'
import InviteMemberDialog from 'app/dashboard/team/components/InviteMemberDialog'
import { shortOutreachDate } from './outreachDate.util'

const outreachAssigneesQueryKey = (outreachId: number) => [
  'outreach-assignees',
  outreachId,
]

// Matches the volunteer assignments home page's key shape (ENG-11053,
// app/volunteer/components/AssignmentsPage.tsx's volunteerAssignmentsQueryKey)
// without importing it — that page lives on a sibling branch not yet in this
// stack — so an assign/remove/invite here also busts a volunteer's own
// "Your assignments" cache once both land on main.
const volunteerAssignmentsQueryKey = (orgSlug: string | undefined) => [
  'volunteer-assignments',
  orgSlug,
]

interface OutreachAssigneesSectionProps {
  outreachId: number
}

// Manager+ assign/unassign for one outreach envelope (ENG-11056), gated on
// win-team-accounts. Volunteers never reach this drawer at all (their whole
// surface is /volunteer's own assignments page), so there's no second,
// role-based gate here — only the flag.
export const OutreachAssigneesSection = ({
  outreachId,
}: OutreachAssigneesSectionProps) => {
  const { ready: flagReady, enabled: flagEnabled } = useTeamAccountsFlag(false)
  const organization = useOrganization()
  const orgSlug = organization?.slug
  const queryClient = useQueryClient()
  const { successSnackbar, errorSnackbar } = useSnackbar()

  const [pickerOpen, setPickerOpen] = useState(false)
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
      setPickerOpen(false)
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
  const candidates = members.filter(
    (member) => member.role !== 'owner' && !assignedUserIds.has(member.userId),
  )
  const hasRows = assignees.length > 0 || pendingInvites.length > 0

  return (
    <>
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <Eyebrow>Assignees</Eyebrow>
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="small">
                <PlusIcon className="size-4" />
                Assign
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 p-0">
              <div className="max-h-72 divide-y divide-border overflow-y-auto">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 p-3 text-left transition-colors hover:bg-muted"
                  onClick={() => {
                    setPickerOpen(false)
                    setInviteOpen(true)
                  }}
                >
                  <MailIcon className="size-4 text-primary" />
                  <span className="font-medium text-primary">
                    Invite a volunteer
                  </span>
                </button>
                {teamQuery.isError ? (
                  <div className="space-y-1 p-3">
                    <p className="m-0 text-sm text-muted-foreground">
                      Couldn&apos;t load your team.
                    </p>
                    <Button
                      variant="link"
                      className="h-auto p-0"
                      onClick={() => teamQuery.refetch()}
                    >
                      Try again
                    </Button>
                  </div>
                ) : teamQuery.isPending ? (
                  <div className="p-3">
                    <Skeleton className="h-5 w-full" />
                  </div>
                ) : candidates.length === 0 ? (
                  <p className="m-0 p-3 text-sm text-muted-foreground">
                    No other team members to assign.
                  </p>
                ) : (
                  candidates.map((member) => (
                    <button
                      key={member.userId}
                      type="button"
                      disabled={assignMutation.isPending}
                      className="flex w-full flex-col items-start gap-0.5 p-3 text-left transition-colors hover:bg-muted disabled:opacity-50"
                      onClick={() => assignMutation.mutate(member.userId)}
                    >
                      <span className="truncate font-medium text-foreground">
                        {formatName(member.name, member.email)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {ROLE_LABELS[member.role] ?? member.role}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </PopoverContent>
          </Popover>
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
              const displayName =
                assignee.name ??
                members.find((member) => member.userId === assignee.userId)
                  ?.email ??
                `Member #${assignee.userId}`
              return (
                <Card
                  key={assignee.userId}
                  className="flex flex-row items-center justify-between gap-3 p-3"
                >
                  <div className="min-w-0">
                    <p className="m-0 truncate text-sm font-medium text-foreground">
                      {displayName}
                    </p>
                    <p className="m-0 text-xs text-muted-foreground">
                      {ROLE_LABELS[assignee.role] ?? assignee.role} · Assigned{' '}
                      {shortOutreachDate(assignee.createdAt)}
                    </p>
                  </div>
                  <IconButton
                    variant="ghost"
                    size="small"
                    aria-label={`Remove ${displayName}`}
                    disabled={
                      removeMutation.isPending &&
                      removeMutation.variables === assignee.userId
                    }
                    onClick={() => setRemoveTarget(assignee)}
                  >
                    <Trash2Icon className="size-4" />
                  </IconButton>
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
