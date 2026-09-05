'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { TeamMember, PendingInvite } from 'gpApi/api-endpoints'
import {
  Button,
  Card,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@styleguide'
import {
  CircleHelpIcon,
  MoreHorizontalIcon,
  PlusIcon,
  ShieldCheckIcon,
  Trash2Icon,
  UserRoundIcon,
} from '@styleguide/components/ui/icons'
import DashboardLayout from 'app/dashboard/shared/DashboardLayout'
import { NAV_LABELS } from 'app/dashboard/shared/navLabels'
import { clientRequest } from 'gpApi/typed-request'
import {
  useOrganization,
  useOrganizationRole,
} from '@shared/organization-picker'
import { useSnackbar } from 'helpers/useSnackbar'
import {
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  formatName,
  teamQueryKey,
} from '../team.util'
import InviteMemberDrawer from './InviteMemberDrawer'

const TeamPage = (): React.JSX.Element => {
  const organization = useOrganization()
  const role = useOrganizationRole()
  const isOwner = role === 'owner'
  const orgSlug = organization?.slug
  // Team accounts are Win-only in Phase 1 (ENG-10816 non-goal: Serve staff
  // accounts are out of scope — every elected-office surface stays
  // owner-only). The nav item is already excluded for an eo- org
  // (DashboardMenu.tsx), but a direct visit must still degrade cleanly
  // rather than fetch data or render Win-flavored copy (delegate review,
  // PR #1688).
  const isElectedOffice = !!organization?.electedOfficeId
  const queryClient = useQueryClient()
  const { successSnackbar, errorSnackbar } = useSnackbar()
  const [inviteOpen, setInviteOpen] = useState(false)

  // isPending, not isLoading: in React Query v5 isLoading = isPending &&
  // isFetching, so while the query is disabled (orgSlug not resolved yet)
  // isFetching is false and isLoading reads false too — the page would
  // render as loaded-and-empty (bare table, "0 people") for that whole
  // window instead of a skeleton (ENG-11039).
  const { data, isPending, isError } = useQuery({
    queryKey: teamQueryKey(orgSlug),
    queryFn: () =>
      clientRequest('GET /v1/organizations/team', {}).then((res) => res.data),
    enabled: !!orgSlug && !isElectedOffice,
  })

  const invalidateTeam = () =>
    queryClient.invalidateQueries({ queryKey: teamQueryKey(orgSlug) })

  const revokeMutation = useMutation({
    mutationFn: (id: string) =>
      clientRequest('DELETE /v1/organizations/team/invites/:id', { id }),
    onSuccess: async () => {
      successSnackbar('Invitation revoked')
      await invalidateTeam()
    },
    onError: () => errorSnackbar('Failed to revoke the invitation'),
  })

  const removeMutation = useMutation({
    mutationFn: (userId: number) =>
      clientRequest('DELETE /v1/organizations/team/members/:userId', {
        userId: String(userId),
      }),
    onSuccess: async () => {
      successSnackbar('Member removed')
      await invalidateTeam()
    },
    onError: () => errorSnackbar('Failed to remove the member'),
  })

  // ENG-11049: the owner can move an existing member between Campaign
  // Manager and Volunteer — a role change never touches an outreach
  // assignment, so it's a plain PATCH + refetch like remove above.
  const roleMutation = useMutation({
    mutationFn: ({
      userId,
      role,
    }: {
      userId: number
      role: 'campaignAdmin' | 'volunteer'
    }) =>
      clientRequest('PATCH /v1/organizations/team/members/:userId', {
        userId: String(userId),
        role,
      }),
    onSuccess: async () => {
      successSnackbar('Role updated')
      await invalidateTeam()
    },
    onError: () => errorSnackbar('Failed to update the role'),
  })

  const members: TeamMember[] = data?.members ?? []
  const pendingInvites: PendingInvite[] = data?.pendingInvites ?? []

  if (isElectedOffice) {
    return (
      <DashboardLayout
        pathname="/dashboard/team"
        navHeader={{ icon: 'users', label: NAV_LABELS.team }}
      >
        <div className="flex w-full items-center justify-center px-4 py-16 text-center">
          <p className="m-0 max-w-md text-sm text-muted-foreground">
            Team accounts aren’t available for elected offices yet.
          </p>
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout
      pathname="/dashboard/team"
      navHeader={{ icon: 'users', label: NAV_LABELS.team }}
    >
      <div className="w-full bg-muted px-4 py-6 pb-20 sm:px-8 md:px-16">
        <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4">
          <Card className="flex flex-row items-start gap-3 p-6">
            <CircleHelpIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
            <div className="flex flex-col gap-2">
              <h2 className="m-0 text-sm font-semibold text-foreground">
                How roles work
              </h2>
              <p className="m-0 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">
                  Campaign Manager
                </span>{' '}
                {ROLE_DESCRIPTIONS.campaignAdmin}
              </p>
              <p className="m-0 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">Volunteer</span>{' '}
                {ROLE_DESCRIPTIONS.volunteer}
              </p>
            </div>
          </Card>

          <Card className="flex flex-col gap-4 p-6">
            <div className="flex items-center justify-between gap-4">
              <h2 className="m-0 text-xl font-semibold text-foreground">
                {isPending ? (
                  <Skeleton className="h-6 w-40" />
                ) : isError ? (
                  // Never render a count derived from the [] fallback below
                  // — a failed fetch has no member count to report.
                  'Your team'
                ) : (
                  `${members.length} ${members.length === 1 ? 'person' : 'people'} on this campaign`
                )}
              </h2>
              {/* Deliberately not owner-gated: "a manager can invite other
                  managers" is a stated ENG-10816 goal, and POST
                  /v1/organizations/team/invites is intentionally
                  UseOrganization()-only (no @OwnerOnly()) — see the same
                  decision recorded on that route in team.controller.ts.
                  Revoke (below) is manager+ for the same reason (delegate
                  review, PR #1688). */}
              <Button onClick={() => setInviteOpen(true)}>
                <PlusIcon />
                Invite
              </Button>
            </div>

            {isError ? (
              <p className="m-0 text-sm text-destructive">
                Couldn’t load your team. Try refreshing the page.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isPending ? (
                    <TableRow>
                      <TableCell colSpan={4}>
                        <Skeleton className="h-6 w-full" />
                      </TableCell>
                    </TableRow>
                  ) : (
                    members.map((member) => (
                      <TableRow key={member.userId}>
                        <TableCell>
                          {formatName(member.name, member.email)}
                        </TableCell>
                        <TableCell>
                          {ROLE_LABELS[member.role] ?? member.role}
                        </TableCell>
                        <TableCell>{member.email}</TableCell>
                        <TableCell>
                          {isOwner && member.role !== 'owner' && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <IconButton
                                  variant="ghost"
                                  size="small"
                                  aria-label={`Manage ${formatName(member.name, member.email)}`}
                                >
                                  <MoreHorizontalIcon />
                                </IconButton>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {member.role !== 'campaignAdmin' && (
                                  <DropdownMenuItem
                                    disabled={
                                      roleMutation.isPending &&
                                      roleMutation.variables?.userId ===
                                        member.userId
                                    }
                                    onClick={() =>
                                      roleMutation.mutate({
                                        userId: member.userId,
                                        role: 'campaignAdmin',
                                      })
                                    }
                                  >
                                    <ShieldCheckIcon />
                                    Make Campaign Manager
                                  </DropdownMenuItem>
                                )}
                                {member.role !== 'volunteer' && (
                                  <DropdownMenuItem
                                    disabled={
                                      roleMutation.isPending &&
                                      roleMutation.variables?.userId ===
                                        member.userId
                                    }
                                    onClick={() =>
                                      roleMutation.mutate({
                                        userId: member.userId,
                                        role: 'volunteer',
                                      })
                                    }
                                  >
                                    <UserRoundIcon />
                                    Make Volunteer
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuItem
                                  variant="destructive"
                                  disabled={
                                    removeMutation.isPending &&
                                    removeMutation.variables === member.userId
                                  }
                                  onClick={() =>
                                    removeMutation.mutate(member.userId)
                                  }
                                >
                                  <Trash2Icon />
                                  Remove from team
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            )}
          </Card>

          <Card className="flex flex-col gap-4 p-6">
            <h2 className="m-0 text-xl font-semibold text-foreground">
              Pending invites
            </h2>
            {isError ? (
              // Same "never fabricate from the [] fallback" rule as the
              // members card above — an error here is never "no invites."
              <p className="m-0 text-sm text-destructive">
                Couldn’t load pending invites. Try refreshing the page.
              </p>
            ) : !isPending && pendingInvites.length === 0 ? (
              <p className="m-0 text-sm text-muted-foreground">
                No pending invites.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isPending ? (
                    <TableRow>
                      <TableCell colSpan={4}>
                        <Skeleton className="h-6 w-full" />
                      </TableCell>
                    </TableRow>
                  ) : (
                    pendingInvites.map((invite) => (
                      <TableRow key={invite.id}>
                        <TableCell>{invite.name}</TableCell>
                        <TableCell>
                          {ROLE_LABELS[invite.role] ?? invite.role}
                          {/* List-scoped volunteer invites (ENG-11049) are
                              created from — and only make sense in the
                              context of — one outreach list, so a bare
                              "Volunteer" row here would read as a normal
                              team invite. Name the scope inline rather than
                              hiding the row: hiding it would violate the
                              ticket's own AC that these show up here too
                              (delegate review, PR #1736). */}
                          {invite.outreachId != null && (
                            <span className="block text-xs text-muted-foreground">
                              List-scoped
                            </span>
                          )}
                        </TableCell>
                        <TableCell>{invite.email}</TableCell>
                        <TableCell>
                          {invite.outreachId != null ? (
                            // No Revoke here: this invite's Cancel lives with
                            // the outreach that scopes it (the drawer's
                            // Assignees section), where the context to
                            // cancel it safely actually is. Revoking it from
                            // this context-free table would silently cancel
                            // an outreach-scoped invite the manager can't see
                            // here (delegate review, PR #1736).
                            <span
                              className="text-xs text-muted-foreground"
                              title="Manage from the outreach's assignees section"
                            >
                              Managed in outreach
                            </span>
                          ) : (
                            <IconButton
                              variant="ghost"
                              size="small"
                              aria-label={`Revoke invite for ${invite.email}`}
                              // Scoped to THIS row's invite id, not just
                              // isPending — one shared mutation instance backs
                              // every row, so isPending alone would disable
                              // every other pending invite's button while any
                              // one revoke is in flight (delegate review, PR
                              // #1688).
                              disabled={
                                revokeMutation.isPending &&
                                revokeMutation.variables === invite.id
                              }
                              onClick={() => revokeMutation.mutate(invite.id)}
                            >
                              <Trash2Icon />
                            </IconButton>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            )}
          </Card>
        </div>
      </div>

      <InviteMemberDrawer
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        onInvited={invalidateTeam}
      />
    </DashboardLayout>
  )
}

export default TeamPage
